#!/usr/bin/env python3
"""
把繁中服資料表（thewakingsands/ffxiv-datamining-tc 的 CSV）整理成網站用的精簡 JSON。

用法：
  python3 -I scripts/build_data.py --raw <CSV資料夾> --out data
  （--fetch 可自動從 GitHub 下載需要的 CSV 到 --raw 資料夾）

輸出：
  data/items.json    物品（只含配方成品、素材、公司工房用到的物品）
  data/recipes.json  一般製作配方 + 配方等級表
  data/fc.json       公司工房製作（含潛水艇／飛空艇組件）、潛水艇零件數值
  data/actions.json  製作技能 繁中名稱與圖示（巨集用）
  data/sets.json     可製作的裝備套裝（同等級、同系列名稱）
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.request

BASE = "https://raw.githubusercontent.com/thewakingsands/ffxiv-datamining-tc/main/"
FILES = [
    "Item", "Recipe", "RecipeLevelTable", "CraftType", "ItemUICategory",
    "CompanyCraftSequence", "CompanyCraftPart", "CompanyCraftProcess",
    "CompanyCraftSupplyItem", "CompanyCraftType", "SubmarinePart",
    "SubmarineRank", "GatheringItem", "GilShopItem", "SpearfishingItem",
    "FishParameter", "CraftAction", "Action", "ClassJobCategory", "ClassJob",
    "CollectablesShopItem", "CollectablesShopRefine",
]

# 巨集會用到的非製作職專屬技能 (Action sheet) —— 用「職業無關」的木工 ID 取繁中名稱
BUFF_ACTION_IDS = {
    "veneration": 19297,
    "innovation": 19004,
    "greatStrides": 260,
    "wasteNot": 4631,
    "wasteNot2": 4639,
    "manipulation": 4574,
    "finalAppraisal": 19012,
}
# CraftAction sheet (以木工的 ID 為準；其他職業名稱相同)
CRAFT_ACTION_IDS = {
    "basicSynth": 100001,
    "basicTouch": 100002,
    "mastersMend": 100003,
    "standardTouch": 100004,
    "advancedTouch": 100008,
    "byregotsBlessing": 100009,
    "observe": 100010,
    "carefulSynth": 100063,
    "preciseTouch": 100128,
    "muscleMemory": 100136,
    "prudentTouch": 100227,
    "focusedSynth": 100235,
    "focusedTouch": 100243,
    "trainedEye": 100283,
    "preparatoryTouch": 100299,
    "intensiveSynth": 100315,
    "delicateSynth": 100323,
    "reflect": 100387,
    "groundwork": 100403,
    "heartAndSoul": 100419,
    "prudentSynth": 100427,
    "trainedFinesse": 100435,
    "refinedTouch": 100443,
    "immaculateMend": 100467,
    "trainedPerfection": 100475,
}


def fetch(raw):
    os.makedirs(raw, exist_ok=True)
    for f in FILES:
        dst = os.path.join(raw, f + ".csv")
        if os.path.exists(dst) and os.path.getsize(dst) > 100:
            continue
        for attempt in range(3):
            try:
                print("下載", f, file=sys.stderr)
                urllib.request.urlretrieve(BASE + f + ".csv", dst)
                break
            except Exception as e:  # noqa
                print("  失敗", e, file=sys.stderr)
                time.sleep(2)


def load(raw, name):
    """回傳 (欄位名稱->索引, 資料列) ；資料列從第 4 列開始"""
    with open(os.path.join(raw, name + ".csv"), encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    header = rows[1]
    idx = {h: i for i, h in enumerate(header) if h}
    return idx, rows[3:]


def to_int(s, default=0):
    try:
        return int(s)
    except (ValueError, TypeError):
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fetch", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        fetch(a.raw)
    os.makedirs(a.out, exist_ok=True)

    # ---------- 基礎表 ----------
    _, ct_rows = load(a.raw, "CraftType")
    jobs = {to_int(r[0]): r[3] for r in ct_rows}

    _, cat_rows = load(a.raw, "ItemUICategory")
    cat_names = {to_int(r[0]): r[1] for r in cat_rows}

    ii, item_rows = load(a.raw, "Item")
    items_raw = {}
    for r in item_rows:
        k = to_int(r[0])
        if k > 0 and r[ii["Name"]]:
            items_raw[k] = r

    # ---------- 配方等級表 ----------
    li, rlt_rows = load(a.raw, "RecipeLevelTable")
    rlt = {}
    for r in rlt_rows:
        k = to_int(r[0])
        rlt[k] = [
            to_int(r[li["ClassJobLevel"]]), to_int(r[li["Stars"]]),
            to_int(r[li["SuggestedCraftsmanship"]]), to_int(r[li["Difficulty"]]),
            to_int(r[li["Quality"]]), to_int(r[li["ProgressDivider"]]),
            to_int(r[li["QualityDivider"]]), to_int(r[li["ProgressModifier"]]),
            to_int(r[li["QualityModifier"]]), to_int(r[li["Durability"]]),
            to_int(r[li["ConditionsFlag"]]),
        ]

    # ---------- 配方 ----------
    ri, rec_rows = load(a.raw, "Recipe")
    recipes = []
    used_items = set()
    # 「Item{Ingredient}[n]」「Amount{Ingredient}[n]」
    ing_cols = [(ri["Item{Ingredient}[%d]" % n], ri["Amount{Ingredient}[%d]" % n]) for n in range(8)]
    for r in rec_rows:
        rid = to_int(r[0])
        res = to_int(r[ri["Item{Result}"]])
        amt = to_int(r[ri["Amount{Result}"]])
        if rid <= 0 or res <= 0 or amt <= 0 or res not in items_raw:
            continue
        ings = []
        ok = True
        for ci, ca in ing_cols:
            iid, n = to_int(r[ci]), to_int(r[ca])
            if iid > 0 and n > 0:
                if iid not in items_raw:
                    ok = False
                    break
                ings.append([iid, n])
        if not ok or not ings:
            continue
        rl = to_int(r[ri["RecipeLevelTable"]])
        if rl not in rlt:
            continue
        flags = 0
        if r[ri["CanHq"]] == "True":
            flags |= 1
        if r[ri["IsExpert"]] == "True":
            flags |= 2
        if r[ri["IsSpecializationRequired"]] == "True":
            flags |= 4
        if r[ri["CanQuickSynth"]] == "True":
            flags |= 8
        recipes.append([
            rid, to_int(r[ri["CraftType"]]), res, amt,
            [x for p in ings for x in p],
            rl,
            to_int(r[ri["MaterialQualityFactor"]]),
            to_int(r[ri["DifficultyFactor"]]),
            to_int(r[ri["QualityFactor"]]),
            to_int(r[ri["DurabilityFactor"]]),
            to_int(r[ri["RequiredCraftsmanship"]]),
            to_int(r[ri["RequiredControl"]]),
            flags,
        ])
        used_items.add(res)
        for iid, _ in ings:
            used_items.add(iid)

    # ---------- 公司工房 ----------
    si, seq_rows = load(a.raw, "CompanyCraftSequence")
    pi_, part_rows = load(a.raw, "CompanyCraftPart")
    pri, proc_rows = load(a.raw, "CompanyCraftProcess")
    sui, sup_rows = load(a.raw, "CompanyCraftSupplyItem")
    _, cct_rows = load(a.raw, "CompanyCraftType")
    cc_types = {to_int(r[0]): r[1] for r in cct_rows}
    supply = {to_int(r[0]): to_int(r[1]) for r in sup_rows}
    parts = {to_int(r[0]): r for r in part_rows}
    procs = {to_int(r[0]): r for r in proc_rows}

    fc = []
    for r in seq_rows:
        sid = to_int(r[0])
        res = to_int(r[si["ResultItem"]])
        if sid <= 0 or res <= 0 or res not in items_raw:
            continue
        part_list = []
        for n in range(8):
            pid = to_int(r[si["CompanyCraftPart[%d]" % n]])
            if pid <= 0 or pid not in parts:
                continue
            pr = parts[pid]
            ptype = cc_types.get(to_int(pr[pi_["CompanyCraftType"]]), "")
            proc_list = []
            for m in range(3):
                prid = to_int(pr[pi_["CompanyCraftProcess[%d]" % m]])
                if prid <= 0 or prid not in procs:
                    continue
                prow = procs[prid]
                sup_items = []
                for q in range(12):
                    sidx = to_int(prow[pri["SupplyItem[%d]" % q]])
                    qty = to_int(prow[pri["SetQuantity[%d]" % q]])
                    sets = to_int(prow[pri["SetsRequired[%d]" % q]])
                    item = supply.get(sidx, 0)
                    if item > 0 and qty > 0 and sets > 0 and item in items_raw:
                        sup_items.append([item, qty, sets])
                        used_items.add(item)
                if sup_items:
                    proc_list.append(sup_items)
            if proc_list:
                part_list.append([ptype, proc_list])
        if part_list:
            fc.append([sid, res, part_list])
            used_items.add(res)

    # ---------- 潛水艇零件 ----------
    spi, sp_rows = load(a.raw, "SubmarinePart")
    sub_parts = {}
    for r in sp_rows:
        k = to_int(r[0])
        if k > 0:
            sub_parts[k] = [to_int(r[spi[c]]) for c in
                            ("Slot", "Rank", "Components", "Surveillance", "Retrieval",
                             "Speed", "Range", "Favor", "Class", "RepairMaterials")]
    sri, sr_rows = load(a.raw, "SubmarineRank")
    sub_ranks = []
    for r in sr_rows:
        sub_ranks.append([to_int(r[sri[c]]) for c in
                          ("Capacity", "ExpToNext", "SurveillanceBonus", "RetrievalBonus",
                           "SpeedBonus", "RangeBonus", "FavorBonus")])
    # 物品 -> 潛水艇零件 row (Item.AdditionalData)
    sub_item_map = {}
    for iid, r in items_raw.items():
        cname = cat_names.get(to_int(r[ii["ItemUICategory"]]), "")
        if cname.startswith("潛水艇組件"):
            sub_item_map[iid] = [to_int(r[ii["AdditionalData"]]), cname]

    # ---------- 來源標記 ----------
    gi, g_rows = load(a.raw, "GatheringItem")
    gather = {to_int(r[gi["Item"]]) for r in g_rows if to_int(r[gi["Item"]]) > 0}
    spi2, sf_rows = load(a.raw, "SpearfishingItem")
    fish = {to_int(r[spi2["Item"]]) for r in sf_rows if to_int(r[spi2["Item"]]) > 0}
    fi, f_rows = load(a.raw, "FishParameter")
    fish |= {to_int(r[fi["Item"]]) for r in f_rows if to_int(r[fi["Item"]]) > 0}
    gsi, gs_rows = load(a.raw, "GilShopItem")
    gilshop = {to_int(r[gsi["Item"]]) for r in gs_rows if to_int(r[gsi["Item"]]) > 0}

    # ---------- 物品輸出 ----------
    cat_index = []
    cat_pos = {}
    items = []
    for iid in sorted(used_items):
        r = items_raw.get(iid)
        if not r:
            continue
        cid = to_int(r[ii["ItemUICategory"]])
        if cid not in cat_pos:
            cat_pos[cid] = len(cat_index)
            cat_index.append(cat_names.get(cid, ""))
        flags = 0
        if r[ii["CanBeHq"]] == "True":
            flags |= 1
        if r[ii["IsUntradable"]] == "True":
            flags |= 2
        if iid in gather:
            flags |= 4
        if iid in fish:
            flags |= 8
        price = to_int(r[ii["Price{Mid}"]]) if iid in gilshop else 0
        if iid in gilshop:
            flags |= 16
        items.append([
            iid, r[ii["Name"]], to_int(r[ii["Icon"]]), to_int(r[ii["Level{Item}"]]),
            cat_pos[cid], flags, price,
        ])

    # ---------- 技能名稱與圖示 ----------
    ai, act_rows = load(a.raw, "Action")
    act_by_id = {to_int(r[0]): (r[ai["Name"]], to_int(r[ai["Icon"]])) for r in act_rows if to_int(r[0]) in BUFF_ACTION_IDS.values()}
    ci, ca_rows = load(a.raw, "CraftAction")
    ca_by_id = {to_int(r[0]): (r[ci["Name"]], to_int(r[ci["Icon"]])) for r in ca_rows if to_int(r[0]) in CRAFT_ACTION_IDS.values()}
    action_names, action_icons = {}, {}
    for key, aid in BUFF_ACTION_IDS.items():
        action_names[key], action_icons[key] = act_by_id.get(aid, ("", 0))
    for key, aid in CRAFT_ACTION_IDS.items():
        action_names[key], action_icons[key] = ca_by_id.get(aid, ("", 0))
    missing = [k for k, v in action_names.items() if not v]
    if missing:
        print("警告：缺少技能名稱", missing, file=sys.stderr)

    # ---------- 裝備套裝 ----------
    cji, cj_rows = load(a.raw, "ClassJob")
    job_zh = {}
    for r in cj_rows:
        ab = r[cji["Abbreviation"]]
        if ab and r[cji["Name"]]:
            job_zh.setdefault(ab, r[cji["Name"]])
    cci, cc_rows = load(a.raw, "ClassJobCategory")
    abbrs = [h for h in cci if h not in ("#", "Name")]
    DOH = {"CRP", "BSM", "ARM", "GSM", "LTW", "WVR", "ALC", "CUL"}
    DOL = {"MIN", "BTN", "FSH"}
    cjc = {}
    for r in cc_rows:
        k = to_int(r[0])
        cat_jobs = [ab for ab in abbrs if r[cci[ab]] == "True"]
        cjc[k] = (r[cci["Name"]], cat_jobs)

    def role_of(jobs):
        js = set(jobs)
        if not js:
            return None
        if js <= DOH:
            return "製作"
        if js <= DOL:
            return "採集"
        if js & (DOH | DOL):
            return None
        return "戰鬥"

    def lcp(names):
        p = names[0]
        for n in names[1:]:
            i = 0
            while i < len(p) and i < len(n) and p[i] == n[i]:
                i += 1
            p = p[:i]
        return p

    recipe_results = {r[2] for r in recipes}
    clusters = {}
    for iid in recipe_results:
        r = items_raw.get(iid)
        if not r or to_int(r[ii["EquipSlotCategory"]]) <= 0:
            continue
        elvl = to_int(r[ii["Level{Equip}"]])
        if elvl <= 1:
            continue
        c = to_int(r[ii["ClassJobCategory"]])
        if c not in cjc:
            continue
        role = role_of(cjc[c][1])
        if not role:
            continue
        name = r[ii["Name"]]
        key = (role, to_int(r[ii["Level{Item}"]]), elvl, name[:2])
        clusters.setdefault(key, []).append((iid, c, to_int(r[ii["EquipSlotCategory"]])))
    sets = []
    used_cjc = set()
    for (role, ilvl, elvl, _), mem in clusters.items():
        if len(mem) < 3:
            continue
        mem.sort(key=lambda x: (x[2], x[0]))
        nm = lcp([items_raw[m[0]][ii["Name"]] for m in mem])
        if len(nm) < 2:
            nm = items_raw[mem[0][0]][ii["Name"]][:2]
        sets.append([nm, role, ilvl, elvl, [[m[0], m[1]] for m in mem]])
        used_cjc.update(m[1] for m in mem)
    sets.sort(key=lambda s: (-s[3], -s[2], s[1], s[0]))
    sets_out = {
        "sets": sets,
        "cjc": {k: [cjc[k][0], cjc[k][1]] for k in sorted(used_cjc)},
        "jobs": job_zh,
    }

    # ---------- 收藏品收藏價值門檻 ----------
    cfi, cf_rows = load(a.raw, "CollectablesShopRefine")
    refine = {to_int(r[0]): [to_int(r[cfi["LowCollectability"]]), to_int(r[cfi["MidCollectability"]]), to_int(r[cfi["HighCollectability"]])] for r in cf_rows}
    csi, cs_rows = load(a.raw, "CollectablesShopItem")
    collect = {}
    for r in cs_rows:
        iid = to_int(r[csi["Item"]])
        ref = refine.get(to_int(r[csi["CollectablesShopRefine"]]))
        if iid in recipe_results and ref and ref[0] > 0 and iid not in collect:
            collect[iid] = ref

    meta = {"builtAt": time.strftime("%Y-%m-%d", time.gmtime()), "source": "thewakingsands/ffxiv-datamining-tc"}

    def dump(name, obj):
        path = os.path.join(a.out, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        print(name, os.path.getsize(path) // 1024, "KB", file=sys.stderr)

    dump("items.json", {"meta": meta, "cats": cat_index, "items": items})
    dump("recipes.json", {"jobs": [jobs[k] for k in sorted(jobs)], "rlt": rlt, "recipes": recipes, "collect": collect})
    dump("fc.json", {"seqs": fc, "subItems": sub_item_map, "subParts": sub_parts, "subRanks": sub_ranks})
    dump("actions.json", {"names": action_names, "icons": action_icons})
    dump("sets.json", sets_out)
    print("物品 %d / 配方 %d / 工房 %d / 潛水艇零件 %d / 套裝 %d" % (len(items), len(recipes), len(fc), len(sub_parts), len(sets)), file=sys.stderr)


if __name__ == "__main__":
    main()
