from __future__ import annotations

import modal


app = modal.App("cliff-watch")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi[standard]",
        "policyengine-us==1.755.5",
        "policyengine-core==3.28.0",
        "spm-calculator==0.3.1",
    )
    .add_local_dir("api", "/root/api")
    .add_local_dir("cliff_watch", "/root/cliff_watch")
)


@app.function(image=image, timeout=300, memory=4096)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def fastapi_app():
    import sys

    if "/root" not in sys.path:
        sys.path.insert(0, "/root")

    from cliff_watch.modal_api import create_app

    return create_app()
