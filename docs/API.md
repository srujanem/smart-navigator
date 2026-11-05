# Navigator API Contract (v2)

Base URL: `/api` (Vite dev server proxies `/api` and `/media` to `http://localhost:8000`).
All image URLs returned by the API are absolute paths like `/media/venues/city-care/photos/abc.jpg`.

## Types (TypeScript)

```ts
type VenueType = 'hospital' | 'campus' | 'mall' | 'office';

interface VenueSummary {
  id: string; slug: string; name: string; type: VenueType; city: string;
  tagline: string; accent: string;            // hex colour, e.g. "#0ea5e9"
  cover_url: string | null;
  stats: { buildings: number; floors: number; places: number; people: number; photos: number };
}

interface Floor { id: string; level: number; name: string }
interface Building { id: string; name: string; x: number; y: number; w: number; d: number; floors: Floor[] }
interface Category { key: string; label: string; count: number }

interface VenueDetail extends VenueSummary {
  description: string;
  buildings: Building[];
  categories: Category[];
  emergency_node_id: string | null;
  entrance_node_id: string | null;
}

interface GNode {
  id: string; name: string; kind: string;      // corridor|room|department|cabin|lift|stairs|entrance|washroom|counter|ward|exit|emergency|cafeteria|lab|shop|classroom|hostel_room ...
  category: string | null;                     // key from Category, null for corridors
  building_id: string; building_name: string; floor_id: string; level: number; floor_name: string;
  x: number; y: number;                        // metres, venue site coordinates
  is_place: boolean; photo_url: string | null; photo_count: number;
}
interface GEdge { id: string; source: string; target: string; distance: number; kind: 'walk'|'door'|'stairs'|'lift'|'outdoor'; accessible: boolean; closed: boolean }
interface Graph { nodes: GNode[]; edges: GEdge[] }

type PersonStatus = 'available' | 'busy' | 'leave' | 'moved';
interface Person {
  id: string; name: string; role: string; title: string; department: string;
  node_id: string; node_name: string; level: number; building_name: string;
  schedule: string; status: PersonStatus; status_note: string;
  target_node_id: string;                      // where to route (node_id, or the moved-to node)
  avatar_color: string;
}

interface SearchResult { type: 'place' | 'person'; id: string; name: string; subtitle: string; node_id: string; score: number; status?: PersonStatus }
interface SearchResponse { query: string; interpreted: string | null; results: SearchResult[] }

interface Candidate {
  node_id: string; name: string; kind: string; building_name: string; level: number; floor_name: string;
  score: number;            // 0..1 fused
  visual: number;           // 0..1
  text: number;             // 0..1 OCR match
  matched_photo_url: string | null;
  reason: string;
}
interface TraceStep { step: string; detail: string; ms: number }
interface LocalizeResult {
  log_id: string;
  status: 'confident' | 'uncertain' | 'no_match';
  confidence: number;
  best: Candidate | null;
  candidates: Candidate[];  // top 3
  ocr_text: string[];
  trace: TraceStep[];
  engine: { embedder: string; ocr: string | null; face_blur: boolean };
  query_photo_url: string;
}

interface Step {
  index: number; node_id: string; name: string; instruction: string;
  icon: 'start'|'straight'|'left'|'right'|'up'|'down'|'lift'|'arrive';
  distance_m: number; level: number; photo_url: string | null;
}
interface Route {
  from_node: string; to_node: string; profile: 'walk' | 'wheelchair';
  distance_m: number; eta_s: number; path: string[]; levels: number[];
  steps: Step[];
  alternatives: { path: string[]; distance_m: number; eta_s: number; label: string }[];
  closures_avoided: number; notice: string | null;
}
```

## Public endpoints

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{status, embedder, ocr, face_blur, venues}` |
| GET | `/api/venues` | `?q=` | `VenueSummary[]` |
| GET | `/api/venues/{slug}` | | `VenueDetail` |
| GET | `/api/venues/{slug}/graph` | | `Graph` |
| GET | `/api/venues/{slug}/people` | `?q=` | `Person[]` |
| GET | `/api/venues/{slug}/sample-queries` | | `{id: string; label: string; hint: string; photo_url: string}[]` (unindexed visitor test photos to try `/localize` in one click) |
| GET | `/api/venues/{slug}/search` | `?q=&from=<node_id>` | `SearchResponse` (handles "nearest washroom", symptoms like "heart doctor") |
| POST | `/api/venues/{slug}/localize` | multipart: `file` (image), optional `level` | `LocalizeResult` |
| POST | `/api/venues/{slug}/localize/{log_id}/confirm` | `{node_id, contribute: boolean}` | `{ok, added_photo}` |
| POST | `/api/venues/{slug}/route` | `{from_node, to_node, profile}` | `Route` (HTTP 400 `{detail}` if no route) |

## Admin endpoints (header `Authorization: Bearer <token>`)

Demo login: `admin@navigator.dev` / `admin123`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/login` | `{email, password}` | `{token, user:{name,email,role}}` |
| GET | `/api/admin/venues/{slug}/overview` | | `{stats:{routes_total, routes_today, localizations, localization_accuracy, photos, nodes_with_photos, nodes_total, people}, top_destinations:[{node_id,name,count}], failed_searches:[{query,count}], crowd:[{node_id,name,level,count}], hourly:number[24], recent_localizations:[{id, predicted_name, confirmed_name, confidence, created_at, photo_url}]}` |
| GET | `/api/admin/venues/{slug}/dataset` | | `{embedder, totals:{photos,nodes,covered}, nodes:[{node_id,name,kind,level,building_name,x,y,photo_count,coverage:'none'|'low'|'good',photos:[{id,url,source,quality}]}]}` |
| POST | `/api/admin/venues/{slug}/photos` | multipart: `node_id`, `files` (multiple) | `{accepted:[{id,url,quality}], rejected:[{filename,reason}]}` |
| DELETE | `/api/admin/photos/{id}` | | `{ok}` |
| POST | `/api/admin/venues/{slug}/index/rebuild` | | `IndexReport` |
| GET | `/api/admin/venues/{slug}/index/report` | | `IndexReport \| null` |
| POST | `/api/admin/venues/{slug}/people` | Person fields (name, role, title, department, node_id, schedule) | `Person` |
| PATCH | `/api/admin/people/{id}` | `{status?, status_note?, target_node_id?}` | `Person` |
| GET | `/api/admin/venues/{slug}/closures` | | `[{id, edge_id, source, target, source_name, target_name, reason}]` |
| POST | `/api/admin/venues/{slug}/closures` | `{edge_id, reason}` | closure |
| DELETE | `/api/admin/closures/{id}` | | `{ok}` |

```ts
interface IndexReport {
  embedder: string; photos: number; nodes: number;
  top1: number; top3: number;              // leave-one-out accuracy 0..1
  per_node: { node_id: string; name: string; n: number; top1: number }[];
  confusions: { a: string; b: string; count: number }[];   // node names
  built_at: string; ms: number;
}
```
