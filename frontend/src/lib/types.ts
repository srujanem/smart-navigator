export type VenueType = 'hospital' | 'campus' | 'mall' | 'office';

export interface VenueSummary {
  id: string;
  slug: string;
  name: string;
  type: VenueType;
  city: string;
  tagline: string;
  accent: string;
  cover_url: string | null;
  owner_id?: string | null;
  owner_name?: string;
  stats: {
    buildings: number;
    floors: number;
    places: number;
    people: number;
    photos: number;
  };
}

export interface Floor {
  id: string;
  level: number;
  name: string;
  blueprint_url?: string | null;
}

export interface Building {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floors: Floor[];
}

export interface Category {
  key: string;
  label: string;
  count: number;
}

export interface VenueDetail extends VenueSummary {
  description: string;
  buildings: Building[];
  categories: Category[];
  emergency_node_id: string | null;
  entrance_node_id: string | null;
}

export interface GNode {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  building_id: string;
  building_name: string;
  floor_id: string;
  level: number;
  floor_name: string;
  x: number;
  y: number;
  keywords?: string;
  is_place: boolean;
  photo_url: string | null;
  photo_count: number;
}

export type EdgeKind = 'walk' | 'door' | 'stairs' | 'lift' | 'outdoor';

export interface GEdge {
  id: string;
  source: string;
  target: string;
  distance: number;
  kind: EdgeKind;
  accessible: boolean;
  stretcher_ok?: boolean;
  closed: boolean;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export type PersonStatus = 'available' | 'busy' | 'leave' | 'moved';

export interface Person {
  id: string;
  name: string;
  role: string;
  title: string;
  department: string;
  node_id: string;
  node_name: string;
  level: number;
  building_name: string;
  schedule: string;
  status: PersonStatus;
  status_note: string;
  target_node_id: string;
  avatar_color: string;
}

export interface SearchResult {
  type: 'place' | 'person';
  id: string;
  name: string;
  subtitle: string;
  node_id: string;
  score: number;
  status?: PersonStatus;
}

export interface SearchResponse {
  query: string;
  interpreted: string | null;
  results: SearchResult[];
}

export interface OCRBox {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  confidence: number;
}

export interface Candidate {
  node_id: string;
  name: string;
  kind: string;
  building_name: string;
  level: number;
  floor_name: string;
  score: number;
  visual: number;
  text: number;
  matched_photo_url: string | null;
  matched_heading_deg?: number | null;
  reason: string;
}

export interface TraceStep {
  step: string;
  detail: string;
  ms: number;
}

export interface LocalizeResult {
  log_id: string;
  status: 'confident' | 'uncertain' | 'no_match';
  confidence: number;
  best: Candidate | null;
  candidates: Candidate[];
  ocr_text: string[];
  ocr_boxes?: OCRBox[];
  faces_blurred?: number;
  trace: TraceStep[];
  engine: {
    embedder: string;
    ocr: string | null;
    face_blur: boolean;
  };
  query_photo_url: string;
}

export type StepIcon =
  | 'start'
  | 'straight'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'lift'
  | 'arrive';

export interface Step {
  index: number;
  node_id: string;
  name: string;
  instruction: string;
  icon: StepIcon;
  distance_m: number;
  level: number;
  photo_url: string | null;
}

export type RouteProfile = 'walk' | 'wheelchair' | 'stretcher';

export interface RouteAlternative {
  path: string[];
  distance_m: number;
  eta_s: number;
  label: string;
}

export interface RouteLeg {
  leg_index: number;
  from_node: string;
  from_name: string;
  to_node: string;
  to_name: string;
  distance_m: number;
  eta_s: number;
  path: string[];
}

export interface Route {
  from_node: string;
  to_node: string;
  stops?: string[];
  legs?: RouteLeg[];
  profile: RouteProfile;
  distance_m: number;
  eta_s: number;
  path: string[];
  levels: number[];
  steps: Step[];
  alternatives: RouteAlternative[];
  closures_avoided: number;
  notice: string | null;
  orientation_hint?: string | null;
  offline_fallback?: boolean;
}

export interface SampleQuery {
  id: string;
  label: string;
  hint: string;
  photo_url: string;
}

export interface HealthStatus {
  status: string;
  embedder: string;
  ocr: string | null;
  face_blur: boolean;
  venues: number;
}

export interface AdminUser {
  id?: string;
  name: string;
  email: string;
  role: string;
  organization?: string;
  bio?: string;
  avatar_color?: string;
  token_version?: number;
  created_at?: string;
}

export interface AuthResponse {
  token: string;
  user: AdminUser;
}

export interface UploaderProfileResponse {
  user: AdminUser;
  stats: {
    venues_created: number;
    nodes_mapped: number;
    photos_uploaded: number;
    avg_photo_quality: number;
  };
  venues: VenueSummary[];
}

export interface AdminOverview {
  stats: {
    routes_total: number;
    routes_today: number;
    localizations: number;
    localization_accuracy: number;
    photos: number;
    nodes_with_photos: number;
    nodes_total: number;
    people: number;
  };
  top_destinations: {
    node_id: string;
    name: string;
    count: number;
  }[];
  failed_searches: {
    query: string;
    count: number;
  }[];
  crowd: {
    node_id: string;
    name: string;
    level: number;
    count: number;
  }[];
  hourly: number[];
  recent_localizations: {
    id: string;
    predicted_name: string;
    confirmed_name: string | null;
    confidence: number;
    created_at: string;
    photo_url: string | null;
  }[];
}

export interface DatasetPhoto {
  id: string;
  url: string;
  source: string;
  quality: number;
  heading_deg?: number | null;
}

export type CoverageLevel = 'none' | 'low' | 'good';

export interface DatasetNode {
  node_id: string;
  name: string;
  kind: string;
  level: number;
  building_name: string;
  x: number;
  y: number;
  photo_count: number;
  coverage: CoverageLevel;
  photos: DatasetPhoto[];
}

export interface DatasetResponse {
  embedder: string;
  totals: {
    photos: number;
    nodes: number;
    covered: number;
  };
  nodes: DatasetNode[];
}

export interface UploadPhotosResponse {
  accepted: {
    id: string;
    url: string;
    quality: number;
    heading_deg?: number | null;
  }[];
  rejected: {
    filename: string;
    reason: string;
  }[];
}

export interface IndexReport {
  embedder: string;
  photos: number;
  nodes: number;
  top1: number;
  top3: number;
  per_node: {
    node_id: string;
    name: string;
    n: number;
    top1: number;
  }[];
  confusions: {
    a: string;
    b: string;
    count: number;
  }[];
  built_at: string;
  ms: number;
}

export interface Closure {
  id: string;
  edge_id: string;
  source: string;
  target: string;
  source_name: string;
  target_name: string;
  reason: string;
}

export interface CreatePersonPayload {
  name: string;
  role: string;
  title: string;
  department: string;
  node_id: string;
  schedule: string;
}

export interface UpdatePersonPayload {
  status?: PersonStatus;
  status_note?: string;
  target_node_id?: string;
}

export interface CreateVenuePayload {
  name: string;
  slug?: string;
  type: VenueType;
  city: string;
  tagline: string;
  description?: string;
  accent?: string;
  initial_building_name?: string;
  initial_floor_name?: string;
}

export interface CreateNodePayload {
  building_id: string;
  floor_id: string;
  name: string;
  kind: string;
  category?: string | null;
  x: number;
  y: number;
  keywords?: string;
  is_place?: boolean;
}

export interface UpdateNodePayload {
  name?: string;
  kind?: string;
  category?: string | null;
  x?: number;
  y?: number;
  keywords?: string;
  is_place?: boolean;
}

export interface CreateEdgePayload {
  source: string;
  target: string;
  kind: EdgeKind;
  distance?: number;
  accessible?: boolean;
  stretcher_ok?: boolean;
}
