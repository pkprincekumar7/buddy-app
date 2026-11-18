"""The onboarding service: the conversational onboarding's seven answers, per child.

docs/auth-users-split.md 12.1; endpoints in docs/auth-users-split-api.md. The app keeps the
answers during the chat and sends all seven once at the end (`PUT …/onboarding`), which
publishes `onboarding.conversation_completed`; a later change publishes
`onboarding.answers_updated`. The worker (build plan 5.1) keeps the `child_access` copy from
children's events and deletes a user's or a child's conversations. Onboarding calls no LLM.
"""
