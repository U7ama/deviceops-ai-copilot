"""Clean Option B: Bound MCPClient teardown without modifying site-packages.

Overrides stop() to bound background thread join to 2.0s so hanging AnyIO/stdio
threads cannot block process shutdown or delay completed investigation results.
"""
from concurrent import futures
import asyncio
import logging
import sys
from types import TracebackType
from strands.tools.mcp import MCPClient

logger = logging.getLogger(__name__)


class BoundedMCPClient(MCPClient):
    """MCPClient subclass that bounds thread join during context manager exit."""

    def stop(
        self,
        exc_type: type[BaseException] | None = None,
        exc_val: BaseException | None = None,
        exc_tb: TracebackType | None = None,
    ) -> None:
        if sys.is_finalizing():
            return

        if self._background_thread is not None:
            if self._background_thread_event_loop is not None:
                async def _set_close_event() -> None:
                    if self._close_future and not self._close_future.done():
                        self._close_future.set_result(None)

                try:
                    asyncio.run_coroutine_threadsafe(
                        coro=_set_close_event(), loop=self._background_thread_event_loop
                    )
                except Exception:
                    pass

            # Bound join to 2.0s; thread is a daemon thread and will be reclaimed
            self._background_thread.join(timeout=2.0)
            if self._background_thread.is_alive():
                logger.warning("MCPClient background thread still active after 2.0s join; proceeding")

        if self._background_thread_event_loop is not None:
            try:
                self._background_thread_event_loop.close()
            except Exception:
                pass

        self._init_future = futures.Future()
        self._background_thread = None
        self._background_thread_session = None
        self._background_thread_event_loop = None
        self._close_future = None

