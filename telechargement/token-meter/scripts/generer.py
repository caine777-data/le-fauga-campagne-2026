#!/usr/bin/env python3
"""generer.py : générer des images par trois voies, au choix de l'utilisateur.

  1. LOCAL  (ComfyUI sur ton PC, 0 €)
     python generer.py comfy "prompt" [--neg "..."] [--largeur 1024] [--hauteur 1024]
                       [--etapes 20] [--graine N] [--nombre 1] [--workflow wf.json]
                       [--sortie dossier] [--serveur http://127.0.0.1:8188]
     python generer.py comfy --verifier          → serveur joignable ? modèles présents ?

     --workflow : un workflow exporté de ComfyUI au format API (« Save (API) »).
     Le texte {{PROMPT}} (et {{NEG}}) y est remplacé ; sinon le premier nœud
     CLIPTextEncode reçoit le prompt. Graine et taille sont posées si les nœuds
     KSampler / RandomNoise / EmptyLatentImage existent. Sans --workflow, un
     workflow simple est construit sur le premier modèle trouvé (Flux de préférence).

  2. FICHE  (prompt à coller dans Gemini, 0 token d'image)
     python generer.py fiche "prompt" --titre nom [--format 16:9] [--nombre 4] [--notes "..."]
       → prompts/AAAA-MM-JJ-nom.md + dossier entrants/nom/ où déposer les images.
     python generer.py entrants [--titre nom]
       → liste les images déposées (une ligne chacune), sans les ouvrir.

  3. API  (Gemini, payant, automatique) — clé dans la variable GEMINI_API_KEY
     python generer.py api "prompt" [--modele gemini-2.5-flash-image] [--nombre 1] [--sortie dossier]

Chaque commande n'affiche que les chemins produits : les images restent sur le disque.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

IMAGES = {".png", ".jpg", ".jpeg", ".webp"}


def die(msg: str, code: int = 1) -> None:
    print(f"ERREUR : {msg}")
    sys.exit(code)


def slug(s: str) -> str:
    s = re.sub(r"[^\w-]+", "-", s.lower(), flags=re.UNICODE).strip("-")
    return s[:60] or "image"


# ── 1. ComfyUI ───────────────────────────────────────────────────────────────

def http_json(url: str, data: dict | None = None, timeout: float = 30) -> dict:
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def comfy_models(server: str) -> list[str]:
    info = http_json(f"{server}/object_info/CheckpointLoaderSimple")
    try:
        return list(info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0])
    except (KeyError, IndexError, TypeError):
        return []


def basic_workflow(ckpt: str, w: int, h: int, steps: int) -> dict:
    flux = "flux" in ckpt.lower()
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{PROMPT}}", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{NEG}}", "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0],
            "seed": 0, "steps": steps, "cfg": 1.0 if flux else 6.5,
            "sampler_name": "euler", "scheduler": "simple" if flux else "normal", "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "claude"}},
    }


def fill_workflow(wf: dict, prompt: str, neg: str, seed: int, w: int | None, h: int | None) -> dict:
    raw = json.dumps(wf)
    had_placeholder = "{{PROMPT}}" in raw
    raw = raw.replace("{{PROMPT}}", json.dumps(prompt)[1:-1]).replace("{{NEG}}", json.dumps(neg)[1:-1])
    wf = json.loads(raw)
    if not had_placeholder:
        enc = [n for n in wf.values() if n.get("class_type") == "CLIPTextEncode"]
        if not enc:
            die("le workflow n'a ni {{PROMPT}} ni nœud CLIPTextEncode")
        enc[0]["inputs"]["text"] = prompt
    for node in wf.values():
        t, inp = node.get("class_type", ""), node.get("inputs", {})
        if t in ("KSampler", "KSamplerAdvanced") and "seed" in inp:
            inp["seed"] = seed
        if t in ("KSamplerAdvanced",) and "noise_seed" in inp:
            inp["noise_seed"] = seed
        if t == "RandomNoise" and "noise_seed" in inp:
            inp["noise_seed"] = seed
        if t in ("EmptyLatentImage", "EmptySD3LatentImage") and w and h:
            inp["width"], inp["height"] = w, h
    return wf


def cmd_comfy(a) -> None:
    server = a.serveur.rstrip("/")
    try:
        models = comfy_models(server)
    except (urllib.error.URLError, OSError):
        die(f"ComfyUI ne répond pas sur {server}. Lance ComfyUI sur le PC (run_nvidia_gpu.bat), puis relance.")
    if a.verifier:
        flux = [m for m in models if "flux" in m.lower()]
        print(f"OK ComfyUI joignable ({server}) | {len(models)} modèle(s)"
              f"{' | Flux : ' + ', '.join(flux[:3]) if flux else ''}"
              f"{' | ' + ', '.join(models[:3]) if models and not flux else ''}")
        return
    if not a.prompt:
        die("prompt manquant")
    if a.workflow:
        base = json.loads(Path(a.workflow).read_text(encoding="utf-8"))
        if "nodes" in base and "links" in base:
            die("ce workflow est au format interface : dans ComfyUI, l'exporter avec « Save (API) »")
    else:
        if not models:
            die("aucun modèle (checkpoint) trouvé dans ComfyUI : utiliser --workflow avec ton workflow Flux exporté")
        ckpt = next((m for m in models if "flux" in m.lower()), models[0])
        base = basic_workflow(ckpt, a.largeur, a.hauteur, a.etapes)

    out_dir = Path(a.sortie)
    out_dir.mkdir(parents=True, exist_ok=True)
    client = uuid.uuid4().hex
    saved: list[str] = []
    for i in range(a.nombre):
        seed = (a.graine + i) if a.graine is not None else random.randrange(2**31)
        wf = fill_workflow(base, a.prompt, a.neg, seed, a.largeur, a.hauteur)
        try:
            pid = http_json(f"{server}/prompt", {"prompt": wf, "client_id": client})["prompt_id"]
        except urllib.error.HTTPError as e:
            die(f"ComfyUI refuse le workflow : {e.read().decode(errors='replace')[:400]}")
        t0 = time.time()
        while True:
            hist = http_json(f"{server}/history/{pid}")
            if pid in hist:
                break
            if time.time() - t0 > a.delai:
                die(f"rien après {a.delai} s (file ComfyUI occupée ?)")
            time.sleep(1.5)
        entry = hist[pid]
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            msgs = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
            die(f"ComfyUI : {msgs[-1][1].get('exception_message', 'erreur') if msgs else 'erreur'}")
        for node in entry.get("outputs", {}).values():
            for img in node.get("images", []):
                q = urllib.parse.urlencode({k: img.get(k, "") for k in ("filename", "subfolder", "type")})
                with urllib.request.urlopen(f"{server}/view?{q}", timeout=60) as r:
                    dest = out_dir / f"{slug(a.titre or a.prompt[:40])}-{seed}{Path(img['filename']).suffix}"
                    dest.write_bytes(r.read())
                    saved.append(str(dest))
        print(f"OK {i + 1}/{a.nombre} graine {seed} ({time.time() - t0:.0f} s)")
    print("Images :", *saved, sep="\n  ")
    print("Pour les regarder à moindre coût : media.py apercu IMAGE ; pour comparer les variantes : media.py galerie DOSSIER.")


# ── 2. Fiche Gemini ──────────────────────────────────────────────────────────

def cmd_fiche(a) -> None:
    name = slug(a.titre)
    day = dt.date.today().isoformat()
    pdir, edir = Path("prompts"), Path("entrants") / name
    pdir.mkdir(exist_ok=True)
    edir.mkdir(parents=True, exist_ok=True)
    path = pdir / f"{day}-{name}.md"
    fmt = f"Format {a.format}. " if a.format else ""
    body = f"""# {a.titre}

## Prompt à coller dans Gemini

```
{a.prompt.strip()}

{fmt}Génère {a.nombre} variante{'s' if a.nombre > 1 else ''}.
```
{('## Notes' + chr(10) + chr(10) + a.notes.strip() + chr(10)) if a.notes else ''}
## Ensuite

1. Colle le bloc ci-dessus dans Gemini (gemini.google.com), choisis les images qui te plaisent.
2. Enregistre-les dans `{edir.as_posix()}/`.
3. Dis à Claude : « images déposées pour {name} » — il les reprend sans les recharger en entier.
"""
    path.write_text(body, encoding="utf-8")
    print(f"OK fiche : {path}")
    print(f"Dépôt des images : {edir}/")


def cmd_entrants(a) -> None:
    root = Path("entrants") / slug(a.titre) if a.titre else Path("entrants")
    if not root.exists():
        die(f"{root} n'existe pas")
    files = sorted((p for p in root.rglob("*") if p.suffix.lower() in IMAGES), key=lambda p: p.stat().st_mtime)
    if not files:
        print(f"Aucune image dans {root}/ pour l'instant.")
        return
    for p in files:
        dims = ""
        try:
            data = p.read_bytes()[:32]
            if data[:8] == b"\x89PNG\r\n\x1a\n":
                dims = f" {int.from_bytes(data[16:20], 'big')}x{int.from_bytes(data[20:24], 'big')}"
        except OSError:
            pass
        print(f"{p.as_posix()}{dims} {p.stat().st_size / 1e6:.1f} Mo")


# ── 3. API Gemini ────────────────────────────────────────────────────────────

def cmd_api(a) -> None:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        die("GEMINI_API_KEY absente (clé sur aistudio.google.com, puis setx GEMINI_API_KEY \"...\").")
    out_dir = Path(a.sortie)
    out_dir.mkdir(parents=True, exist_ok=True)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{a.modele}:generateContent"
    saved = []
    for i in range(a.nombre):
        body = {"contents": [{"parts": [{"text": a.prompt}]}],
                "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]}}
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                res = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            die(f"API Gemini {e.code} : {e.read().decode(errors='replace')[:400]}")
        parts = [p for c in res.get("candidates", []) for p in c.get("content", {}).get("parts", [])]
        imgs = [p["inlineData"] for p in parts if "inlineData" in p]
        if not imgs:
            txt = " ".join(p.get("text", "") for p in parts)[:300]
            die(f"pas d'image renvoyée. Réponse : {txt or json.dumps(res)[:300]}")
        for j, img in enumerate(imgs):
            ext = ".png" if "png" in img.get("mimeType", "") else ".jpg"
            dest = out_dir / f"{slug(a.titre or a.prompt[:40])}-{int(time.time())}-{i}{j}{ext}"
            dest.write_bytes(base64.b64decode(img["data"]))
            saved.append(str(dest))
    print("OK Images :", *saved, sep="\n  ")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("comfy")
    s.add_argument("prompt", nargs="?")
    s.add_argument("--neg", default="")
    s.add_argument("--largeur", type=int, default=1024)
    s.add_argument("--hauteur", type=int, default=1024)
    s.add_argument("--etapes", type=int, default=20)
    s.add_argument("--graine", type=int)
    s.add_argument("--nombre", type=int, default=1)
    s.add_argument("--workflow")
    s.add_argument("--titre")
    s.add_argument("--sortie", default="generees")
    s.add_argument("--serveur", default=os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"))
    s.add_argument("--delai", type=int, default=900)
    s.add_argument("--verifier", action="store_true")
    s.set_defaults(f=cmd_comfy)

    s = sub.add_parser("fiche")
    s.add_argument("prompt")
    s.add_argument("--titre", required=True)
    s.add_argument("--format", default="")
    s.add_argument("--nombre", type=int, default=4)
    s.add_argument("--notes", default="")
    s.set_defaults(f=cmd_fiche)

    s = sub.add_parser("entrants")
    s.add_argument("--titre")
    s.set_defaults(f=cmd_entrants)

    s = sub.add_parser("api")
    s.add_argument("prompt")
    s.add_argument("--modele", default=os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"))
    s.add_argument("--nombre", type=int, default=1)
    s.add_argument("--titre")
    s.add_argument("--sortie", default="generees")
    s.set_defaults(f=cmd_api)

    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
