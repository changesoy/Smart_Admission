import math, os, sys, urllib.request, json
from PIL import Image, ImageDraw

TK = "913914b9096fb242c196babc64950515"
Z = int(sys.argv[1])
minlon, minlat, maxlon, maxlat = [float(x) for x in sys.argv[2:6]]
out = sys.argv[6]
scale = int(sys.argv[7]) if len(sys.argv) > 7 else 2
WIDTH = int(sys.argv[8]) if len(sys.argv) > 8 else 2
TILE = 256
ROADS = json.load(open("c:/Users/29114/Desktop/123/Smart_Admission/data/roads.geojson", encoding="utf-8"))

def lon2tx(lon): return (lon + 180.0) / 360.0 * (2 ** Z)
def lat2ty(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (2 ** Z)

def tile(x, y):
    c = f"C:/Users/29114/AppData/Local/Temp/vec_tile_{Z}_{x}_{y}.jpg"
    if os.path.exists(c) and os.path.getsize(c) > 1000:
        return Image.open(c).convert("RGB")
    u = (f"https://t1.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
         f"&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={Z}&TILEROW={y}&TILECOL={x}&tk={TK}")
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    d = urllib.request.urlopen(req, timeout=30).read()
    open(c, "wb").write(d)
    return Image.open(c).convert("RGB")

x0, x1 = lon2tx(minlon) * TILE, lon2tx(maxlon) * TILE
y0, y1 = lat2ty(maxlat) * TILE, lat2ty(minlat) * TILE
tx0, tx1 = int(x0 // TILE), int(x1 // TILE)
ty0, ty1 = int(y0 // TILE), int(y1 // TILE)
cv = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        cv.paste(tile(tx, ty), ((tx - tx0) * TILE, (ty - ty0) * TILE))
img = cv.crop((int(x0 - tx0 * TILE), int(y0 - ty0 * TILE), int(x1 - tx0 * TILE), int(y1 - ty0 * TILE)))
img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
d = ImageDraw.Draw(img)
def px(lon, lat): return ((lon2tx(lon) * TILE - x0) * scale, (lat2ty(lat) * TILE - y0) * scale)
for f in ROADS["features"]:
    g = f["geometry"]
    parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
    color = (220, 0, 220)
    if f["properties"].get("type") == "河流":
        color = (0, 90, 220)
    elif f["properties"].get("type") == "铁路":
        color = (120, 0, 120)
    for part in parts:
        d.line([px(a, b) for a, b in part], fill=color, width=WIDTH)
img.save(out)
print(out, img.size)

