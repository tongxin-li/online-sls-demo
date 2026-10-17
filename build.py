"""Rebuild the deployable page with Python 3 and no additional packages."""
import argparse
import html
import re
from pathlib import Path


def build(source_url):
    source = Path(__file__).resolve().parent / "src"
    document = (source / "page-template.html").read_text(encoding="utf-8")
    interface = (source / "interface.html").read_text(encoding="utf-8")
    interface = interface.replace("__DEMO_REFERENCE_STUDY__", (source / "reference-study.html").read_text(encoding="utf-8"))
    # The exported template already loads the chart dependency after the footer.
    interface = re.sub(r'\s*<script src="https://cdn\.jsdelivr\.net/npm/d3@7\.9\.0/dist/d3\.min\.js"></script>\s*$', "", interface)
    interface = interface.replace('<div id="power-response-demo">', '<main id="power-response-demo">', 1)
    interface = interface.replace('<div role="alert" id="pr-error" hidden></div>\n</div>', '<div role="alert" id="pr-error" hidden></div>\n</main>', 1)
    if not interface.rstrip().endswith("</main>"):
        raise ValueError("The interface must have one complete main element")
    replacements = {
        "__DEMO_SHELL_CSS__": (source / "site-shell.css").read_text(encoding="utf-8") + "\n" + (source / "equipment.css").read_text(encoding="utf-8"),
        "__DEMO_HEADER__": (source / "site-header.html").read_text(encoding="utf-8").replace("__SOURCE_URL__", html.escape(source_url, quote=True)),
        "__DEMO_FOOTER__": (source / "site-footer.html").read_text(encoding="utf-8"),
        "__DEMO_INTERFACE_HTML__": interface,
        "__DEMO_RESPONSES_JS__": ((source / "response-controller.js").read_text(encoding="utf-8") + "\n" + (source / "forecast-calibration.js").read_text(encoding="utf-8")).replace("</script", "<\\/script"),
        "__DEMO_SIMULATION_JS__": (source / "simulation.js").read_text(encoding="utf-8").replace("</script", "<\\/script"),
        "__DEMO_EQUIPMENT_JS__": (source / "equipment.js").read_text(encoding="utf-8").replace("</script", "<\\/script"),
        "__DEMO_TOPOLOGY_JS__": (source / "topology-timeline.js").read_text(encoding="utf-8").replace("</script", "<\\/script"),
        "__DEMO_INTERFACE_JS__": (source / "interface.js").read_text(encoding="utf-8").replace("</script", "<\\/script"),
    }
    for marker, content in replacements.items():
        if document.count(marker) != 1:
            raise ValueError("Missing or repeated template marker " + marker)
        document = document.replace(marker, content, 1)
    if re.search(r"__DEMO_[A-Z_]+__|__SOURCE_URL__", document):
        raise ValueError("An unresolved template marker remains")
    return document


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "index.html")
    parser.add_argument("--source-url", default="https://github.com/tongxin-li/online-sls-demo")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build(args.source_url), encoding="utf-8")
    print(args.output)
