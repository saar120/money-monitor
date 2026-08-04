from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent
URL = ROOT.joinpath("prototype-ia.html").as_uri()
OUTPUT = ROOT / "rendered" / "prototype-ia"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        for variant in ("A", "B", "C"):
            for screen in ("home", "activity", "plan", "advisor"):
                page = browser.new_page(viewport={"width": 1280, "height": 1000})
                errors: list[str] = []
                page.on("pageerror", lambda error, bucket=errors: bucket.append(str(error)))
                page.goto(f"{URL}?variant={variant}&screen={screen}", wait_until="load")
                page.screenshot(path=OUTPUT / f"variant-{variant}-{screen}.png")
                if screen == "home":
                    page.screenshot(path=OUTPUT / f"variant-{variant}.png")
                if errors:
                    raise RuntimeError(f"variant {variant}, {screen}: {'; '.join(errors)}")
                page.close()
        browser.close()


if __name__ == "__main__":
    main()
