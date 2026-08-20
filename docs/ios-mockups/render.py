from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent
INDEX_URL = ROOT.joinpath("index.html").as_uri()
SCREEN_DIR = ROOT / "rendered" / "screens"
BOARD_DIR = ROOT / "rendered" / "boards"

SCREENS = [
    "welcome",
    "connect",
    "faceid",
    "ready",
    "home",
    "activity",
    "search",
    "transaction",
    "filters",
    "review",
    "plan",
    "budget-detail",
    "budget-edit",
    "net-worth",
    "asset-detail",
    "advisor",
    "advisor-chat",
    "accounts",
    "account-detail",
    "sync-history",
    "categories",
    "alerts",
    "settings",
    "offline",
    "home-dark",
    "advisor-dark",
]

BOARDS = ["setup", "everyday", "planning", "control", "system"]


def main() -> None:
    SCREEN_DIR.mkdir(parents=True, exist_ok=True)
    BOARD_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)

        for screen_id in SCREENS:
            page = browser.new_page(viewport={"width": 786, "height": 1704})
            errors: list[str] = []
            page.on("pageerror", lambda error, bucket=errors: bucket.append(str(error)))
            page.goto(f"{INDEX_URL}?screen={quote(screen_id)}&scale=2", wait_until="load")
            page.screenshot(path=SCREEN_DIR / f"{screen_id}.png")
            if errors:
                raise RuntimeError(f"{screen_id}: {'; '.join(errors)}")
            page.close()

        for board_id in BOARDS:
            page = browser.new_page(viewport={"width": 1720, "height": 1200})
            errors = []
            page.on("pageerror", lambda error, bucket=errors: bucket.append(str(error)))
            page.goto(f"{INDEX_URL}?board={quote(board_id)}", wait_until="load")
            page.screenshot(path=BOARD_DIR / f"{board_id}.png", full_page=True)
            if errors:
                raise RuntimeError(f"{board_id}: {'; '.join(errors)}")
            page.close()

        browser.close()


if __name__ == "__main__":
    main()
