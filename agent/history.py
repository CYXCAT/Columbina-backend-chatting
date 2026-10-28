import logging
import os

import httpx

logger = logging.getLogger("companion.history")


class HistoryClient:
    """Reads and appends conversation history through the web app's internal API."""

    def __init__(self, user_id: str) -> None:
        self._user_id = user_id
        self._base = os.environ.get("COMPANION_API_URL", "http://localhost:3000").rstrip("/")
        self._headers = {"Authorization": f"Bearer {os.environ['AGENT_INTERNAL_SECRET']}"}

    async def load(self, limit: int = 20) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    f"{self._base}/api/internal/history",
                    params={"userId": self._user_id, "limit": limit},
                    headers=self._headers,
                )
                r.raise_for_status()
                return r.json()["messages"]
        except Exception:
            logger.exception("failed to load history")
            return []

    async def append(self, role: str, text: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(
                    f"{self._base}/api/internal/history",
                    json={"userId": self._user_id, "role": role, "text": text},
                    headers=self._headers,
                )
                r.raise_for_status()
        except Exception:
            logger.exception("failed to append history")
