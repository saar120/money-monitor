# Agent guidelines

## Navigation

- For UI work, establish whether the target is desktop, iPhone, or both before editing. Desktop is Vue in `dashboard/`; iPhone is Expo/React Native in `mobile/`.
- For feature ownership, shared calculations, Advisor delivery, setup, validation, and synthetic QA, read [docs/development.md](docs/development.md).
- For iPhone layout, localization, fixture scenarios, or pairing checks, read [mobile/README.md](mobile/README.md).
- For financial dates, Saved View, pairing, and mutation terminology, read [CONTEXT.md](CONTEXT.md).
- For a request based on the latest branch, fetch that branch and compare its tip with HEAD before inspecting feature availability. Preserve unrelated changes when updating the checkout.

## PR screenshots

- Keep exploratory captures and QA galleries outside the tracked repository.
- When visual proof helps review, include at most three final screenshots showing distinct states, unless the user asks for more. Use synthetic data in every capture.
- Before pushing, check the PR diff for unnecessary images and personal data.
