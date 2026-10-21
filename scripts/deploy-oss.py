#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 templates 下的静态页上传到 OSS（脱敏版，凭据走环境变量）。

用法：
    set OSS_AK=... & set OSS_SK=... & set OSS_BUCKET=...
    python scripts/deploy-oss.py
可选：
    OSS_ENDPOINT（默认 oss-cn-hangzhou.aliyuncs.com）
    OSS_PREFIX（默认 course-kit）
"""
import os
from pathlib import Path
import oss2

ROOT = Path(__file__).resolve().parent.parent / "templates"
AK = os.environ.get("OSS_AK", "")
SK = os.environ.get("OSS_SK", "")
BUCKET = os.environ.get("OSS_BUCKET", "")
ENDPOINT = os.environ.get("OSS_ENDPOINT", "oss-cn-hangzhou.aliyuncs.com")
PREFIX = os.environ.get("OSS_PREFIX", "course-kit").strip("/")

FILES = [
    ("course/course.html", "text/html; charset=utf-8"),
    ("course/admin.html", "text/html; charset=utf-8"),
    ("course/grader.html", "text/html; charset=utf-8"),
    ("live.html", "text/html; charset=utf-8"),
    ("promo.html", "text/html; charset=utf-8"),
]

if not (AK and SK and BUCKET):
    raise SystemExit("请先设置 OSS_AK / OSS_SK / OSS_BUCKET 环境变量")

bucket = oss2.Bucket(oss2.Auth(AK, SK), ENDPOINT, BUCKET)
for rel, ctype in FILES:
    src = ROOT / rel
    if not src.exists():
        print("skip missing", rel)
        continue
    key = PREFIX + "/" + rel
    bucket.put_object(key, src.read_bytes(), headers={
        "Content-Type": ctype,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
    })
    print("uploaded", key, src.stat().st_size)
print("done")
