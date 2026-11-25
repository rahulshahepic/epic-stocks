"""Bounded PDF text extraction shared by imports and support retrieval."""
import os
import re
import threading


class StatementUnreadable(ValueError):
    """The upload is not a PDF this server will spend more time on."""


class StatementParserBusy(RuntimeError):
    """Every parse slot is taken. Caller should answer 503, not 500."""


# Extracting text is the most expensive thing an anonymous caller can ask this
# server to do — POST /api/trial/analyze takes no session — and the cost is not
# where you would guess. Measured against this parser:
#
#     a real statement (the test fixture)      1.4k chars    0.05 s     ~0 MB
#     200 loan rows over 4 pages               13.6k chars   0.42 s     25 MB
#     64 sparse pages                          5.1k chars    0.18 s      8 MB
#     64 dense pages (a 36 KB upload)          486k chars     24 s    ~980 MB
#     1 page, 400k show operators (183 KB)         —         OOM      >1.5 GB
#
# Pages are not the driver: 64 sparse pages cost nothing and one dense page can
# exhaust the container, which is capped at 512 MB. Characters are the driver,
# at roughly 2 KB of resident memory each, because every glyph becomes an
# object. So the bound that matters is on text volume, and it has to be applied
# *before* the page is interpreted — after that the memory is already spent.
MAX_PDF_PAGES = 16
# Text a statement may carry, counted from the show operators in the content
# streams. Just under twice the 200-row statement above and ~18x the real
# fixture — a statement would need several hundred loan rows to reach it — and
# it holds a single parse near 65 MB, so a full set of parse slots stays inside
# the container's 512 MB alongside the rest of the app.
MAX_TEXT_CHARS = 25_000
# Ceiling on the pre-flight's own decompression: content streams are deflated,
# and the one-page case above expands 183 KB into 25 MB of operators.
MAX_CONTENT_BYTES = 4 * 1024 * 1024
# Backstop on the extracted result, for a PDF whose cost the pre-flight could
# not see (an encoding it could not walk, say).
MAX_STATEMENT_LINES = 20_000

# Even a bounded parse is ~80 MB, and a sync endpoint runs in a threadpool of
# 40 — enough concurrent parses to exhaust the container on their own. Slots
# are taken without waiting so an overloaded server sheds load instead of
# queueing 40 deep behind it.
PDF_PARSE_SLOTS = max(1, int(os.getenv("PDF_PARSE_SLOTS", "3")))
_parse_slots = threading.BoundedSemaphore(PDF_PARSE_SLOTS)

# A PDF string: literal (...) with escapes, or hex <...>.
_SHOW_STRING = re.compile(rb"\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>", re.S)


def _measure(pdf) -> None:
    """Reject a PDF whose text volume would cost more than it is worth.

    Reads and decompresses each page's content streams — cheap, and orders of
    magnitude below interpreting them — and counts the bytes inside text-show
    operators. That count is an upper bound on the glyphs pdfminer would build,
    which is what the memory is actually spent on. Costs 1-80 ms where the
    parse it guards costs seconds.
    """
    from pdfminer.pdftypes import resolve1

    if len(pdf.pages) > MAX_PDF_PAGES:
        raise StatementUnreadable(
            f"That PDF has more than {MAX_PDF_PAGES} pages — a Stock Loan "
            f"Statement is a few. Upload just the statement."
        )

    chars = 0
    content = 0
    for page in pdf.pages:
        streams = page.page_obj.contents
        if not isinstance(streams, list):
            streams = [streams]
        for stream in streams:
            try:
                data = resolve1(stream).get_data()
            except Exception:
                # An unreadable stream contributes nothing we can measure; the
                # line backstop in extract_lines still covers the result.
                continue
            content += len(data)
            if content > MAX_CONTENT_BYTES:
                raise StatementUnreadable(
                    "That PDF holds far more drawing data than a Stock Loan Statement."
                )
            for match in _SHOW_STRING.finditer(data):
                chars += len(match.group(0)) - 2
            if chars > MAX_TEXT_CHARS:
                raise StatementUnreadable(
                    "That PDF holds far more text than a Stock Loan Statement."
                )


def extract_lines(pdf_bytes: bytes) -> list[str]:
    """Pull ordered text lines out of the PDF, one visual row per line.

    Raises StatementUnreadable for a file that is not a readable PDF or is
    costlier than this parser will take on, StatementParserBusy when every
    parse slot is in use, and RuntimeError only when pdfplumber is missing.
    """
    try:
        import pdfplumber
    except ImportError as e:  # pragma: no cover - dependency is in requirements.txt
        raise RuntimeError("pdfplumber is required to read loan statement PDFs") from e

    import io

    if not _parse_slots.acquire(blocking=False):
        raise StatementParserBusy(
            "The importer is busy reading other statements. Try again in a moment."
        )
    try:
        lines: list[str] = []
        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                _measure(pdf)
                for page in pdf.pages:
                    lines.extend((page.extract_text() or "").split("\n"))
                    if len(lines) > MAX_STATEMENT_LINES:
                        raise StatementUnreadable(
                            "That PDF holds far more text than a Stock Loan Statement."
                        )
        except StatementUnreadable:
            raise
        except RecursionError as exc:
            # Deeply nested objects in a crafted PDF. Not something to retry.
            raise StatementUnreadable("That PDF could not be read.") from exc
        except Exception as exc:
            # pdfminer raises its own family of errors on a malformed file, and
            # anything that reaches here is the upload's fault, not the server's.
            raise StatementUnreadable("That PDF could not be read.") from exc
        return lines
    finally:
        _parse_slots.release()
