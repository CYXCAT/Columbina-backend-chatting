import asyncio
import json
import logging
import os

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    ConversationItemAddedEvent,
    JobContext,
    cli,
    inference,
    llm,
    room_io,
)

from history import HistoryClient
from persona import GREETING, INSTRUCTIONS, normalize_language

load_dotenv(".env.local")
logger = logging.getLogger("companion")

VOICES = {
    "en": os.environ.get("VOICE_EN", "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"),
    "zh": os.environ.get("VOICE_ZH", "d4d4b115-57a0-48ea-9a1a-9898966c2966"),
}

server = AgentServer()


@server.rtc_session(agent_name="companion")
async def companion(ctx: JobContext) -> None:
    meta = json.loads(ctx.job.metadata or "{}")
    user_id = meta.get("userId")
    lang = normalize_language(meta.get("language"))
    history = HistoryClient(user_id) if user_id else None

    chat_ctx = llm.ChatContext()
    if history:
        for m in await history.load():
            chat_ctx.add_message(role=m["role"], content=m["text"])

    session = AgentSession(
        llm=inference.LLM(model=os.environ.get("LLM_MODEL", "openai/gpt-4.1-mini")),
        tts=inference.TTS(
            model=os.environ.get("TTS_MODEL", "cartesia/sonic-3"),
            voice=VOICES[lang],
            language=lang,
        ),
    )

    if history:
        @session.on("conversation_item_added")
        def _persist(ev: ConversationItemAddedEvent) -> None:
            item = ev.item
            if getattr(item, "role", None) in ("user", "assistant") and item.text_content:
                asyncio.create_task(history.append(item.role, item.text_content))

    await session.start(
        room=ctx.room,
        agent=Agent(instructions=INSTRUCTIONS[lang], chat_ctx=chat_ctx),
        room_options=room_io.RoomOptions(audio_input=False),
    )
    await session.generate_reply(instructions=GREETING[lang])


if __name__ == "__main__":
    cli.run_app(server)
