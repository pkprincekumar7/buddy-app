"""The discover service: each child's AI personality, generated and built on the server.

docs/auth-users-split.md 8 and 12.1; endpoints in docs/auth-users-split-api.md. The
personality starts on its own when onboarding's conversation completes, is generated once
by the worker (job type `generate_personality_analysis`) from discover's own copies, and is
stored with the `view_model` the Discover pages render (`adaptAiPersonalityToViewModel`,
now on the server). Passing the reveal splash (`POST …/personality/viewed`) makes Discover
done, which unlocks Grow.
"""
