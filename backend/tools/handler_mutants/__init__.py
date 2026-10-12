"""Hand-built mutant lists for code mutmut can't mutate.

mutmut skips decorated functions, and every FastAPI route handler (plus the
lifespan, exception handlers and middleware in main.py) is decorated. Each
module here lists (name, exact source text, replacement) mutants for one such
file, plus the tests to run against it. tools/mutate_handlers.py runs them;
see docs/mutation-testing.md.
"""

from types import ModuleType

from . import admin, audio, auth, children, downloads, jobs, llm, main, users

MODULES: dict[str, ModuleType] = {
    "admin": admin,
    "audio": audio,
    "auth": auth,
    "children": children,
    "downloads": downloads,
    "jobs": jobs,
    "llm": llm,
    "main": main,
    "users": users,
}
