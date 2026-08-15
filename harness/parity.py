#!/usr/bin/env python3
"""Parity harness engine: snapshot Odoo state, diff two snapshots, report.

Usage:
  parity.py snapshot <odoo_url> <db> <uid> <pw> <ref_prefix> <out.json>
  parity.py diff <a.json> <b.json>     # exit 0 = parity, 1 = differences
"""
import json, sys, urllib.request

# Fields compared per model. Volatile fields (id, timestamps, sequence) excluded.
TRACKED = {
    "res.partner":       ["ref", "name", "phone", "email", "street", "zip", "customer_rank"],
    "product.product":   ["uuid", "name", "default_code", "sale_ok"],
}

def rpc(url, db, uid, pw, model, method, args, kwargs=None):
    body = {"jsonrpc":"2.0","method":"call","params":{"service":"object","method":"execute_kw",
            "args":[db,int(uid),pw,model,method,args]+([kwargs] if kwargs else [])},"id":1}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if r.get("error"): raise RuntimeError(json.dumps(r["error"]))
    return r["result"]

def snapshot(url, db, uid, pw, prefix):
    snap = {}
    # partners by ref prefix
    partners = rpc(url,db,uid,pw,"res.partner","search_read",
                   [[["ref","=like",prefix+"%"]]], {"fields":TRACKED["res.partner"]})
    for p in partners:
        key = "res.partner:"+str(p["ref"])
        rec = {k: p.get(k) for k in TRACKED["res.partner"]}
        # attributes rows (parity-relevant), keyed+sorted
        pid = rpc(url,db,uid,pw,"res.partner","search",[[["ref","=",p["ref"]]]])
        attrs = rpc(url,db,uid,pw,"res.partner.attributes","search_read",
                    [[["partner_id","in",pid]]],{"fields":["name","value"]}) if pid else []
        rec["_attributes"] = sorted([{ "name":a["name"], "value":a["value"]} for a in attrs],
                                    key=lambda x:x["name"])
        snap[key] = rec
    # products by uuid — filter to those whose name/uuid we tagged via prefix on default_code
    prods = rpc(url,db,uid,pw,"product.product","search_read",
                [[["default_code","=like",prefix+"%"]]], {"fields":TRACKED["product.product"]})
    for pr in prods:
        snap["product.product:"+str(pr.get("uuid"))] = {k: pr.get(k) for k in TRACKED["product.product"]}
    return snap

def diff(a, b):
    keys = sorted(set(a) | set(b))
    diffs = []
    for k in keys:
        if k not in a: diffs.append((k, "MISSING in A (odoo-connect)", None, b[k])); continue
        if k not in b: diffs.append((k, "MISSING in B (OpenFn)", a[k], None)); continue
        for f in sorted(set(a[k]) | set(b[k])):
            if a[k].get(f) != b[k].get(f):
                diffs.append((k, f, a[k].get(f), b[k].get(f)))
    return diffs

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "snapshot":
        _, _, url, db, uid, pw, prefix, out = sys.argv
        json.dump(snapshot(url,db,uid,pw,prefix), open(out,"w"), indent=2, sort_keys=True)
        print(f"snapshot: {len(json.load(open(out)))} records -> {out}")
    elif cmd == "snapshot-product":
        _, _, url, db, uid, pw, prod_uuid, out = sys.argv
        prods = rpc(url,db,uid,pw,"product.product","search_read",
                    [[["uuid","=",prod_uuid]]], {"fields":TRACKED["product.product"]})
        snap = {"product.product:"+prod_uuid: ({k: prods[0].get(k) for k in TRACKED["product.product"]} if prods else None)}
        json.dump(snap, open(out,"w"), indent=2, sort_keys=True)
        print(f"snapshot-product: {'found' if prods else 'ABSENT'} -> {out}")
    elif cmd == "diff":
        a = json.load(open(sys.argv[2])); b = json.load(open(sys.argv[3]))
        d = diff(a,b)
        print(f"\n=== PARITY REPORT: {len(set(a)|set(b))} records compared ===")
        if not d:
            print("RESULT: PARITY ✓ (odoo-connect and OpenFn produced identical Odoo state)")
            sys.exit(0)
        print(f"RESULT: {len(d)} DIFFERENCE(S)")
        for k, f, av, bv in d:
            print(f"  {k}\n    field={f}  odoo-connect={av!r}  OpenFn={bv!r}")
        sys.exit(1)
