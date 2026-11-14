"""Host-backup status and non-secret settings for authenticated site admins."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from scaffold.auth import get_admin_user
from services import backup_admin

router = APIRouter(prefix="/api/admin/backups", tags=["admin"], dependencies=[Depends(get_admin_user)])


class BackupSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool
    account_id: str = Field(max_length=32)
    bucket: str = Field(max_length=63)
    recipient: str = Field(max_length=62)
    retention_days: int = Field(ge=1, le=3650)
    expected_revision: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class RestoreTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    run_id: str = Field(pattern=r"^\d{8}T\d{6}Z$")
    confirmed: bool


def operation(action):
    try:
        return action()
    except FileExistsError as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except OSError:
        raise HTTPException(503, "Host backup controls are unavailable. The deployment must install the backup handoff.") from None


@router.get("")
def get_backups():
    return backup_admin.status()


@router.put("/settings")
def put_settings(body: BackupSettingsRequest):
    return operation(lambda: backup_admin.save_settings(body.model_dump(exclude={"expected_revision"}), body.expected_revision))


@router.post("/run")
def run_backup():
    return operation(backup_admin.request_run)


@router.post("/restore-test")
def restore_test(body: RestoreTestRequest):
    if not body.confirmed:
        raise HTTPException(400, "Confirm that you successfully restored this backup before recording a test")
    return operation(lambda: backup_admin.record_restore(body.run_id))
