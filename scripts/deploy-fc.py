#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 templates/fc/index.py 部署成阿里云 FC HTTP 函数（脱敏版）。

前置：
    pip install alibabacloud_fc_open20210406 alibabacloud_tea_openapi
    set FC_AK / FC_SK / OSS_AK / OSS_SK / OSS_BUCKET
可选：
    FC_REGION（默认 cn-hangzhou）
    FC_SERVICE（默认 course-kit）
    FC_FUNCTION（默认 camp-api）

说明：函数为匿名 HTTP 触发器，课堂结束可停用；AK/SK 只放函数环境变量。
"""
import base64, io, json, os, zipfile
from pathlib import Path
from alibabacloud_fc_open20210406 import models as fc_models
from alibabacloud_fc_open20210406.client import Client as FCClient
from alibabacloud_tea_openapi import models as oa

REGION = os.environ.get("FC_REGION", "cn-hangzhou")
SERVICE = os.environ.get("FC_SERVICE", "course-kit")
FUNCTION = os.environ.get("FC_FUNCTION", "camp-api")
TRIGGER = "http-trigger"
SRC = Path(__file__).resolve().parent.parent / "templates" / "fc" / "index.py"

AK = os.environ.get("FC_AK", "")
SK = os.environ.get("FC_SK", "")
if not (AK and SK):
    raise SystemExit("请先设置 FC_AK / FC_SK")

client = FCClient(oa.Config(access_key_id=AK, access_key_secret=SK,
                            region_id=REGION, endpoint="fc." + REGION + ".aliyuncs.com"))

def zip_b64():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(str(SRC), "index.py")
    return base64.b64encode(buf.getvalue()).decode()

def ensure_service():
    try:
        client.get_service(SERVICE, fc_models.GetServiceRequest())
    except Exception:
        client.create_service(fc_models.CreateServiceRequest(
            service_name=SERVICE, description="course kit api", internet_access=True))
        print("service created")

def recreate_function():
    for fn in (lambda: client.delete_trigger(SERVICE, FUNCTION, TRIGGER),
               lambda: client.delete_function(SERVICE, FUNCTION)):
        try:
            fn()
        except Exception:
            pass
    env = {
        "OSS_AK": os.environ.get("OSS_AK", ""),
        "OSS_SK": os.environ.get("OSS_SK", ""),
        "OSS_BUCKET": os.environ.get("OSS_BUCKET", ""),
        "OSS_ENDPOINT": os.environ.get("OSS_ENDPOINT", "oss-cn-hangzhou.aliyuncs.com"),
    }
    client.create_function(SERVICE, fc_models.CreateFunctionRequest(
        function_name=FUNCTION, runtime="python3.10", handler="index.handler",
        memory_size=512, cpu=0.5, timeout=30, disk_size=512,
        code=fc_models.Code(zip_file=zip_b64()),
        environment_variables=env, description="course kit api"))
    print("function created")

def ensure_trigger():
    try:
        r = client.get_trigger(SERVICE, FUNCTION, TRIGGER)
        return r.body.url_internet
    except Exception:
        pass
    r = client.create_trigger(SERVICE, FUNCTION, fc_models.CreateTriggerRequest(
        trigger_name=TRIGGER, trigger_type="http",
        trigger_config=json.dumps({"authType": "anonymous", "methods": ["GET", "POST"]})))
    return r.body.url_internet

ensure_service()
recreate_function()
url = ensure_trigger()
print("FC_URL =", url)
print("下一步：把 templates 三个页面里的 FC_API 改成该地址")
