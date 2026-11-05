import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Box,
  Camera,
  Check,
  CheckCircle2,
  Compass,
  DoorOpen,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Map as MapIcon,
  MapPin,
  Mic,
  MicOff,
  Navigation,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Siren,
  Sparkles,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import { FloorPlan2D } from '../components/FloorPlan2D';
import { IsometricVenueArt } from '../components/VenueCard';
import { PhotoLocateModal, type ConfirmedSpot } from '../components/PhotoLocateModal';
import { StatusChip, VenueTypeBadge } from '../components/StatusChip';
import { ErrorState, Skeleton3D } from '../components/ErrorState';
import {
  computeNearestRoute,
  getVenue,
  getVenueGraph,
  getVenuePeople,
  mediaUrl,
  searchVenue,
} from '../lib/api';
import { formatLevel, useVisitorLocation } from '../lib/locationStore';
import type {
  GNode,
  Graph,
  Person,
  SearchResponse,
  VenueDetail,
} from '../lib/types';

const Venue3D = lazy(() => import('../components/Venue3D'));

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: {
    0: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const VenuePage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { location: visitorLoc, setLocation: setVisitorLoc } = useVisitorLocation(slug);

  const meetNodeParam = searchParams.get('meet') || '';

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Locate Modal State
  const [locateOpen, setLocateOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [heroDragActive, setHeroDragActive] = useState(false);
  const [queuedDest, setQueuedDest] = useState<{
    nodeId: string;
    name: string;
  } | null>(null);
  const [manualSelectValue, setManualSelectValue] = useState('');
  const [copiedSpotLink, setCopiedSpotLink] = useState(false);

  // Nearest SOS / Facility Routing State
  const [nearestLoadingKind, setNearestLoadingKind] = useState<string | null>(null);
  const [nearestNotice, setNearestNotice] = useState<string | null>(null);

  // Multi-Stop Visit Checklist State
  const [tripStops, setTripStops] = useState<GNode[]>([]);

  // Smart Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRes, setSearchRes] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);

  // Twin & Places State
  const [twinMode, setTwinMode] = useState<'3d' | '2d'>('3d');
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [inspectedNode, setInspectedNode] = useState<GNode | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const loadVenueBundle = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [vDetail, vGraph, vPeople] = await Promise.all([
        getVenue(slug),
        getVenueGraph(slug),
        getVenuePeople(slug).catch(() => [] as Person[]),
      ]);
      setVenue(vDetail);
      setGraph(vGraph);
      setPeople(vPeople);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load venue digital twin.',
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadVenueBundle();
  }, [loadVenueBundle]);

  // Debounced Smart Search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !slug) {
      setSearchRes(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchVenue(slug, q, visitorLoc?.nodeId)
        .then((res) => {
          if (!cancelled) setSearchRes(res);
        })
        .catch(() => {
          if (!cancelled) setSearchRes({ query: q, interpreted: null, results: [] });
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, slug, visitorLoc?.nodeId]);

  const allLevels = useMemo(() => {
    if (!venue || !graph) return [0];
    const s = new Set<number>();
    venue.buildings.forEach((b) => b.floors.forEach((f) => s.add(f.level)));
    graph.nodes.forEach((n) => s.add(n.level));
    const arr = Array.from(s).sort((a, b) => a - b);
    return arr.length ? arr : [0];
  }, [venue, graph]);

  const placeNodes = useMemo(
    () => (graph ? graph.nodes.filter((n) => n.is_place) : []),
    [graph],
  );

  const entranceNode = useMemo(() => {
    if (!venue || !graph) return null;
    if (venue.entrance_node_id) {
      const found = graph.nodes.find((n) => n.id === venue.entrance_node_id);
      if (found) return found;
    }
    return (
      graph.nodes.find((n) => n.kind.toLowerCase().includes('entrance')) ??
      placeNodes[0] ??
      graph.nodes[0] ??
      null
    );
  }, [venue, graph, placeNodes]);

  const meetNode = useMemo(
    () => (meetNodeParam && graph ? graph.nodes.find((n) => n.id === meetNodeParam) ?? null : null),
    [graph, meetNodeParam],
  );

  const filteredPlaces = useMemo(() => {
    if (activeCategory === 'all') return placeNodes;
    return placeNodes.filter((n) => n.category === activeCategory);
  }, [placeNodes, activeCategory]);

  const exampleQueries = useMemo(() => {
    if (!venue) return ['nearest washroom', 'reception'];
    if (venue.type === 'hospital') {
      return ['heart doctor', 'nearest washroom', 'X-Ray', 'pharmacy', 'emergency'];
    }
    if (venue.type === 'campus') {
      return ['AI Lab', 'nearest washroom', 'library', 'cafeteria', 'auditorium'];
    }
    return ['nearest washroom', 'help desk', 'cafeteria', 'lift'];
  }, [venue]);

  const startVoiceSearch = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      alert('Voice search is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = 'en-IN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      setListening(true);
      rec.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) setSearchQuery(transcript);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const handleNavigateToDestination = (destNodeId: string, destName: string) => {
    if (visitorLoc?.nodeId) {
      navigate(
        `/v/${slug}/route?from=${encodeURIComponent(visitorLoc.nodeId)}&to=${encodeURIComponent(destNodeId)}`,
      );
      return;
    }
    setQueuedDest({ nodeId: destNodeId, name: destName });
    setDroppedFile(null);
    setLocateOpen(true);
  };

  const handleNearestFacility = async (targetKind: string, label: string) => {
    if (!slug) return;
    const originId = visitorLoc?.nodeId ?? entranceNode?.id;
    if (!originId) {
      setLocateOpen(true);
      return;
    }
    setNearestLoadingKind(targetKind);
    setNearestNotice(null);
    try {
      const r = await computeNearestRoute(slug, originId, targetKind, 'walk', {
        headingDeg: visitorLoc?.headingDeg ?? null,
      });
      const fallbackFlag = visitorLoc?.nodeId ? '' : '&fromEntrance=1';
      const emergencyFlag =
        targetKind === 'emergency' || targetKind === 'exit' ? '&emergency=1' : '';
      navigate(
        `/v/${slug}/route?from=${encodeURIComponent(r.from_node)}&to=${encodeURIComponent(
          r.to_node,
        )}${emergencyFlag}${fallbackFlag}`,
      );
    } catch (err) {
      setNearestNotice(
        err instanceof Error
          ? err.message
          : `No mapped ${label.toLowerCase()} node found in this venue yet.`,
      );
      setTimeout(() => setNearestNotice(null), 4000);
    } finally {
      setNearestLoadingKind(null);
    }
  };

  const handleEmergencyRoute = () => {
    if (!venue?.emergency_node_id) {
      void handleNearestFacility('emergency', 'Emergency');
      return;
    }
    const fromId = visitorLoc?.nodeId ?? entranceNode?.id;
    if (!fromId) return;
    const fallbackFlag = visitorLoc?.nodeId ? '' : '&fromEntrance=1';
    navigate(
      `/v/${slug}/route?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(
        venue.emergency_node_id,
      )}&emergency=1${fallbackFlag}`,
    );
  };

  const handleSpotConfirmed = (spot: ConfirmedSpot) => {
    setVisitorLoc({
      nodeId: spot.nodeId,
      name: spot.name,
      buildingName: spot.buildingName,
      level: spot.level,
      floorName: spot.floorName,
      headingDeg: spot.headingDeg ?? null,
      source: spot.source,
      updatedAt: Date.now(),
    });
    if (queuedDest) {
      const destId = queuedDest.nodeId;
      setQueuedDest(null);
      navigate(
        `/v/${slug}/route?from=${encodeURIComponent(spot.nodeId)}&to=${encodeURIComponent(destId)}`,
      );
    }
  };

  const handleShareMySpot = async (viaWhatsApp = false) => {
    if (!visitorLoc || !venue) return;
    const meetUrl = `${window.location.origin}/v/${encodeURIComponent(slug)}?meet=${encodeURIComponent(visitorLoc.nodeId)}`;
    const text = `Meet me at ${visitorLoc.name} (${visitorLoc.buildingName}, ${formatLevel(visitorLoc.level, visitorLoc.floorName)}) inside ${venue.name}: ${meetUrl}`;
    if (viaWhatsApp) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await navigator.clipboard.writeText(meetUrl);
      setCopiedSpotLink(true);
      setTimeout(() => setCopiedSpotLink(false), 2500);
    } catch {
      // Ignore
    }
  };

  const toggleTripStop = (node: GNode) => {
    setTripStops((prev) => {
      if (prev.some((p) => p.id === node.id)) {
        return prev.filter((p) => p.id !== node.id);
      }
      if (prev.length >= 5) return prev;
      return [...prev, node];
    });
  };

  const launchMultiStopTrip = (optimizeOrder: boolean) => {
    if (tripStops.length === 0) return;
    const originId = visitorLoc?.nodeId ?? entranceNode?.id;
    if (!originId) {
      setLocateOpen(true);
      return;
    }
    const allStopIds = [originId, ...tripStops.map((s) => s.id).filter((id) => id !== originId)];
    if (allStopIds.length < 2) return;
    const optQuery = optimizeOrder ? '&optimize=1' : '';
    navigate(
      `/v/${slug}/route?from=${encodeURIComponent(allStopIds[0])}&to=${encodeURIComponent(
        allStopIds[allStopIds.length - 1],
      )}&stops=${encodeURIComponent(allStopIds.join(','))}${optQuery}`,
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="h-9 w-9 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm font-medium text-slate-600">
          Loading venue spatial twin & directory...
        </p>
      </div>
    );
  }

  if (error || !venue || !graph) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-3xl mx-auto pt-12">
          <Link
            to="/venues"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Venues
          </Link>
          <ErrorState
            title="Unable to Load Venue"
            message={error || 'Venue not found.'}
            onRetry={() => void loadVenueBundle()}
          />
        </div>
      </div>
    );
  }

  const peopleSectionTitle =
    venue.type === 'hospital'
      ? 'Doctors & Specialists On-Duty'
      : venue.type === 'campus'
        ? 'Faculty & Lab Coordinators'
        : 'Directory & Staff On-Duty';

  const quickNearestChips = [
    { kind: 'exit', label: 'Nearest Exit', emoji: '🚨', danger: true },
    ...(venue.type === 'hospital'
      ? [{ kind: 'emergency', label: 'Emergency Ward', emoji: '🏥', danger: true }]
      : []),
    { kind: 'washroom', label: 'Nearest Washroom', emoji: '🚻', danger: false },
    { kind: 'lift', label: 'Nearest Lift', emoji: '🛗', danger: false },
    venue.type === 'hospital'
      ? { kind: 'pharmacy', label: 'Pharmacy', emoji: '💊', danger: false }
      : { kind: 'helpdesk', label: 'Help Desk / Reception', emoji: '🛎️', danger: false },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24">
      {/* =================================================================== */}
      {/* STICKY TOP VENUE HUB BAR                                            */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070B18]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3">
          {/* Left: Back + Venue Identity */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/venues"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-slate-300 ring-1 ring-white/10 hover:bg-white/15 hover:text-white transition"
              title="All Venues"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-base sm:text-lg font-extrabold truncate">
                  {venue.name}
                </h1>
                <div className="hidden sm:block shrink-0">
                  <VenueTypeBadge type={venue.type} dark />
                </div>
                {venue.owner_name && (
                  <span className="hidden lg:inline-flex items-center gap-1 rounded-md bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-cyan-300 ring-1 ring-white/10">
                    <ShieldCheck className="h-3 w-3 text-emerald-400" />
                    Mapped by {venue.owner_name}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {venue.city} · {venue.stats.buildings} Buildings · {venue.stats.places} Places
              </p>
            </div>
          </div>

          {/* Right: Current Location Pill + Quick Links + Emergency CTA */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Visitor Current Location Pill */}
            <button
              type="button"
              onClick={() => {
                setQueuedDest(null);
                setDroppedFile(null);
                setLocateOpen(true);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition ring-1 ${
                visitorLoc
                  ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/35 hover:bg-emerald-500/25'
                  : 'bg-amber-500/15 text-amber-200 ring-amber-400/35 hover:bg-amber-500/25'
              }`}
            >
              {visitorLoc ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="max-w-[160px] truncate">
                    At: {visitorLoc.name}
                  </span>
                  <span className="text-[10px] underline opacity-80">Change</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  <span>Location not set · Upload photo</span>
                </>
              )}
            </button>

            <Link
              to={`/v/${slug}/people`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/15 hover:text-white transition"
            >
              <Users className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">
                {venue.type === 'hospital' ? 'Doctors' : 'People'}
              </span>
            </Link>

            <Link
              to={`/admin/map-editor?venue=${encodeURIComponent(slug)}`}
              className="hidden md:inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/15 hover:text-white transition"
            >
              <Lock className="h-3.5 w-3.5 text-indigo-400" />
              Map Studio
            </Link>

            {venue.emergency_node_id && (
              <button
                type="button"
                onClick={handleEmergencyRoute}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-lg shadow-rose-600/35 ring-1 ring-rose-400/50 hover:bg-rose-500 transition animate-pulse"
              >
                <Siren className="h-4 w-4" />
                🚨 Emergency Route
              </button>
            )}
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* "MEET ME HERE" DEEP-LINK HANDOFF BANNER (WHEN ?meet=<nodeId>)       */}
      {/* =================================================================== */}
      {meetNode && (
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 text-white border-b border-white/15">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <Share2 className="h-4 w-4 text-white" />
              </div>
              <div className="text-xs sm:text-sm">
                <span className="font-bold uppercase tracking-wider text-emerald-100 mr-2">
                  Meet Me Here Invite:
                </span>
                Someone shared their indoor spot at{' '}
                <strong className="underline decoration-white/60">
                  {meetNode.name}
                </strong>{' '}
                ({meetNode.building_name} · {formatLevel(meetNode.level, meetNode.floor_name)}).
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleNavigateToDestination(meetNode.id, meetNode.name)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-extrabold text-slate-950 shadow-md hover:bg-emerald-50 transition"
              >
                <Navigation className="h-3.5 w-3.5 text-emerald-600" />
                {visitorLoc ? 'Route to Meet Them' : 'Upload My Photo & Route'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete('meet');
                  setSearchParams(next);
                }}
                className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white"
                aria-label="Dismiss meet invite"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* HERO ACTION ROW: WHERE AM I PHOTO CARD + SMART SEARCH               */}
      {/* =================================================================== */}
      <div className="bg-gradient-to-b from-[#070B18] via-[#0B1329] to-slate-50 pt-7 pb-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Prominent "Where am I? Upload Photo" Hero Card */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setHeroDragActive(true);
              }}
              onDragLeave={() => setHeroDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setHeroDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith('image/')) {
                  setQueuedDest(null);
                  setDroppedFile(f);
                  setLocateOpen(true);
                }
              }}
              className={`lg:col-span-5 relative rounded-3xl p-6 text-white transition-all overflow-hidden flex flex-col justify-between ${
                heroDragActive
                  ? 'bg-cyan-950 ring-2 ring-cyan-400 scale-[1.01]'
                  : 'bg-gradient-to-br from-[#0F1B3D] via-[#0C1530] to-[#080E20] ring-1 ring-white/15 shadow-2xl'
              }`}
            >
              <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-cyan-500/20 blur-3xl" />

              <div className="relative z-10 space-y-3">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/30">
                  <Camera className="h-3.5 w-3.5" />
                  Step 1 · Visual Localization
                </div>

                <h2 className="font-display text-2xl font-extrabold leading-tight">
                  📷 Where am I? Upload Photo
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Snap a still photo of the corridor or signboard in front of you — or drop an image right onto this card. No QR codes or beacons needed.
                </p>

                {visitorLoc && (
                  <div className="rounded-2xl bg-emerald-500/15 px-3.5 py-2.5 ring-1 ring-emerald-400/30 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <div className="truncate">
                          <span className="text-emerald-200">Current start: </span>
                          <strong className="text-white">{visitorLoc.name}</strong>
                          <span className="text-emerald-300/80 ml-1">
                            ({formatLevel(visitorLoc.level, visitorLoc.floorName)})
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVisitorLoc(null)}
                        className="text-emerald-300 hover:text-white ml-2"
                        title="Clear start location"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => void handleShareMySpot(false)}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/20 transition"
                      >
                        {copiedSpotLink ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-300" /> Meet Link Copied!
                          </>
                        ) : (
                          <>
                            <Share2 className="h-3 w-3 text-cyan-300" /> Share My Spot
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleShareMySpot(true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/90 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 transition"
                      >
                        WhatsApp
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="relative z-10 mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setQueuedDest(null);
                    setDroppedFile(null);
                    setLocateOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-600 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-300 hover:to-indigo-500 transition"
                >
                  <Upload className="h-4 w-4" />
                  {visitorLoc ? 'Re-check Location via Photo' : 'Upload / Capture Photo'}
                </button>

                {/* Manual Start Selector */}
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={manualSelectValue}
                    onChange={(e) => {
                      const id = e.target.value;
                      setManualSelectValue('');
                      const found = placeNodes.find((n) => n.id === id);
                      if (found) {
                        setVisitorLoc({
                          nodeId: found.id,
                          name: found.name,
                          buildingName: found.building_name,
                          level: found.level,
                          floorName: found.floor_name,
                          headingDeg: null,
                          source: 'manual',
                          updatedAt: Date.now(),
                        });
                      }
                    }}
                    className="flex-1 rounded-xl bg-white/[0.07] px-3 py-2 text-xs text-slate-200 ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    aria-label="Or pick starting spot manually"
                  >
                    <option value="" className="text-slate-900">
                      Or pick starting spot manually...
                    </option>
                    {placeNodes.map((n) => (
                      <option key={n.id} value={n.id} className="text-slate-900">
                        {n.name} ({n.building_name} · {formatLevel(n.level, n.floor_name)})
                      </option>
                    ))}
                  </select>

                  {entranceNode && visitorLoc?.nodeId !== entranceNode.id && (
                    <button
                      type="button"
                      onClick={() =>
                        setVisitorLoc({
                          nodeId: entranceNode.id,
                          name: entranceNode.name,
                          buildingName: entranceNode.building_name,
                          level: entranceNode.level,
                          floorName: entranceNode.floor_name,
                          headingDeg: null,
                          source: 'manual',
                          updatedAt: Date.now(),
                        })
                      }
                      className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-cyan-300 ring-1 ring-white/15 hover:bg-white/15 transition"
                    >
                      Main Entrance
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Smart Destination, Symptom & Doctor Search Card */}
            <div className="lg:col-span-7 rounded-3xl bg-white p-6 shadow-lift ring-1 ring-slate-900/[0.07] flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-indigo-600">
                      <Sparkles className="h-3.5 w-3.5" />
                      Step 2 · Smart Destination & People Search
                    </span>
                    <h2 className="font-display text-xl sm:text-2xl font-extrabold text-slate-950 mt-0.5">
                      Where do you need to go?
                    </h2>
                  </div>
                </div>

                {/* Search Input + Voice Mic */}
                <div className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        venue.type === 'hospital'
                          ? 'Search rooms, doctors, or symptoms ("heart doctor", "nearest washroom", "X-Ray")...'
                          : 'Search labs, rooms, faculty, or amenities ("nearest washroom", "AI Lab")...'
                      }
                      className="w-full rounded-2xl bg-slate-50 pl-11 pr-10 py-3.5 text-sm font-medium text-slate-900 ring-1 ring-slate-200/90 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-700"
                        aria-label="Clear search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={startVoiceSearch}
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 transition ${
                      listening
                        ? 'bg-rose-600 text-white ring-rose-400 animate-pulse'
                        : 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-600'
                    }`}
                    title="Voice search"
                    aria-label="Voice search"
                  >
                    {listening ? (
                      <MicOff className="h-5 w-5" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Example Natural Queries */}
                {!searchQuery && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs text-slate-400 mr-1">Try asking:</span>
                    {exampleQueries.map((eq) => (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => setSearchQuery(eq)}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                      >
                        "{eq}"
                      </button>
                    ))}
                  </div>
                )}

                {/* Search Results Panel */}
                {searchQuery.trim() !== '' && (
                  <div className="space-y-2.5 pt-1">
                    {searching && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                        Searching places, symptoms & directory...
                      </div>
                    )}

                    {searchRes?.interpreted && (
                      <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-900 ring-1 ring-indigo-200">
                        <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
                        <span>AI Intent Match: {searchRes.interpreted}</span>
                      </div>
                    )}

                    {!searching && searchRes && searchRes.results.length === 0 && (
                      <div className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">
                        No matching rooms or staff for "{searchQuery}". Try another keyword or browse categories below.
                      </div>
                    )}

                    {searchRes && searchRes.results.length > 0 && (
                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200 bg-white thin-scrollbar">
                        {searchRes.results.map((r) => (
                          <button
                            key={`${r.type}-${r.id}`}
                            type="button"
                            onClick={() => handleNavigateToDestination(r.node_id, r.name)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-indigo-50/50 transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                                  r.type === 'person'
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-cyan-100 text-cyan-700'
                                }`}
                              >
                                {r.type === 'person' ? (
                                  <User className="h-4 w-4" />
                                ) : (
                                  <MapPin className="h-4 w-4" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-slate-900 truncate">
                                    {r.name}
                                  </span>
                                  {r.status && <StatusChip status={r.status} />}
                                </div>
                                <div className="text-xs text-slate-500 truncate">
                                  {r.subtitle}
                                </div>
                              </div>
                            </div>

                            <span className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shrink-0">
                              Route
                              <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!searchQuery && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{venue.description}</span>
                </div>
              )}
            </div>
          </div>

          {/* 1-TAP NEAREST FACILITY & EMERGENCY SOS ROUTING BAR */}
          <div className="rounded-2xl bg-white/95 p-3.5 shadow-soft ring-1 ring-slate-900/[0.07] flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-700">
              <DoorOpen className="h-4 w-4 text-rose-600" />
              1-Tap Nearest Essential & SOS:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {quickNearestChips.map((chip) => {
                const isBusy = nearestLoadingKind === chip.kind;
                return (
                  <button
                    key={chip.kind}
                    type="button"
                    disabled={nearestLoadingKind !== null}
                    onClick={() => void handleNearestFacility(chip.kind, chip.label)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      chip.danger
                        ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white'
                        : 'bg-slate-100 text-slate-800 ring-1 ring-slate-200/80 hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span>{chip.emoji}</span>
                    )}
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {nearestNotice && (
            <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
              {nearestNotice}
            </div>
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* MAIN CONTENT: 3D DIGITAL TWIN / 2D BLUEPRINT + DIRECTORY            */}
      {/* =================================================================== */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        {/* INTERACTIVE 3D DIGITAL TWIN + 2D FLOOR PLAN */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-extrabold text-slate-950 flex items-center gap-2">
                <Compass className="h-6 w-6 text-indigo-600" />
                Interactive Spatial Digital Twin
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Click any room, department, lift, or entrance node to view its photo, set it as your location, or route straight there.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Floor Filter Pills (for 3D mode) */}
              {twinMode === '3d' && (
                <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setSelectedLevel('all')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      selectedLevel === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    All Floors
                  </button>
                  {allLevels.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setSelectedLevel(lvl)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        selectedLevel === lvl
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {formatLevel(lvl)}
                    </button>
                  ))}
                </div>
              )}

              {/* 3D / 2D Mode Switcher */}
              <div className="flex items-center rounded-xl bg-slate-200/80 p-1">
                <button
                  type="button"
                  onClick={() => setTwinMode('3d')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    twinMode === '3d'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Box className="h-3.5 w-3.5 text-indigo-600" />
                  3D Twin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTwinMode('2d');
                    if (selectedLevel === 'all') {
                      setSelectedLevel(visitorLoc?.level ?? allLevels[0] ?? 0);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    twinMode === '2d'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MapIcon className="h-3.5 w-3.5 text-cyan-600" />
                  2D Blueprint
                </button>
              </div>
            </div>
          </div>

          <div className="relative h-[450px] sm:h-[530px] w-full">
            {twinMode === '3d' ? (
              <Suspense fallback={<Skeleton3D />}>
                <Venue3D
                  venue={venue}
                  graph={graph}
                  selectedLevel={selectedLevel}
                  selectedNodeId={inspectedNode?.id}
                  startNodeId={visitorLoc?.nodeId}
                  onSelectNode={(n) => setInspectedNode(n)}
                />
              </Suspense>
            ) : (
              <FloorPlan2D
                venue={venue}
                graph={graph}
                selectedLevel={
                  typeof selectedLevel === 'number'
                    ? selectedLevel
                    : visitorLoc?.level ?? allLevels[0] ?? 0
                }
                onChangeLevel={(lvl) => setSelectedLevel(lvl)}
                selectedNodeId={inspectedNode?.id}
                startNodeId={visitorLoc?.nodeId}
                onSelectNode={(n) => setInspectedNode(n)}
              />
            )}

            {/* Selected Node Inspector Overlay Card */}
            {inspectedNode && (
              <div className="absolute right-3 top-3 z-20 w-72 sm:w-80 overflow-hidden rounded-2xl bg-white/95 shadow-2xl ring-1 ring-slate-900/10 backdrop-blur-xl">
                <div className="relative h-36 w-full bg-slate-900 overflow-hidden">
                  {inspectedNode.photo_url ? (
                    <img
                      src={mediaUrl(inspectedNode.photo_url)}
                      alt={inspectedNode.name}
                      className="h-full w-full object-cover hdr-photo"
                    />
                  ) : (
                    <IsometricVenueArt
                      accent={venue.accent || '#0ea5e9'}
                      buildings={1}
                      floors={Math.max(2, Math.abs(inspectedNode.level) + 2)}
                      compact
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setInspectedNode(null)}
                    className="absolute right-2 top-2 rounded-full bg-slate-950/75 p-1.5 text-white hover:bg-slate-950 transition"
                    aria-label="Close inspector"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                        {inspectedNode.building_name} ·{' '}
                        {formatLevel(inspectedNode.level, inspectedNode.floor_name)}
                      </div>
                      <h3 className="font-display text-base font-extrabold text-slate-900">
                        {inspectedNode.name}
                      </h3>
                      <p className="text-xs text-slate-500 capitalize">
                        {inspectedNode.kind.replace(/_/g, ' ')} ·{' '}
                        {inspectedNode.photo_count} reference{' '}
                        {inspectedNode.photo_count === 1 ? 'photo' : 'photos'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setVisitorLoc({
                          nodeId: inspectedNode.id,
                          name: inspectedNode.name,
                          buildingName: inspectedNode.building_name,
                          level: inspectedNode.level,
                          floorName: inspectedNode.floor_name,
                          headingDeg: null,
                          source: 'manual',
                          updatedAt: Date.now(),
                        });
                        setInspectedNode(null);
                      }}
                      className="btn-ghost text-xs py-2 px-2.5"
                    >
                      <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                      I'm Here
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigateToDestination(
                          inspectedNode.id,
                          inspectedNode.name,
                        )
                      }
                      className="btn-primary text-xs py-2 px-2.5"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                      Navigate
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* DOCTORS & STAFF ON-DUTY PREVIEW STRIP */}
        {people.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-extrabold text-slate-950">
                  {peopleSectionTitle}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500">
                  Live status & automatic cabin relocation routing
                </p>
              </div>
              <Link
                to={`/v/${slug}/people`}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-500"
              >
                Full Directory ({people.length})
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {people.slice(0, 6).map((p) => (
                <div
                  key={p.id}
                  className="card p-4 flex flex-col justify-between gap-3 hover:shadow-lift transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold text-white shadow-sm"
                        style={{ backgroundColor: p.avatar_color || '#4f46e5' }}
                      >
                        {p.name
                          .split(' ')
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join('')
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-bold text-slate-900 truncate">
                          {p.name}
                        </h3>
                        <p className="text-xs text-slate-500 truncate">
                          {p.title} · {p.department}
                        </p>
                      </div>
                    </div>
                    <StatusChip status={p.status} />
                  </div>

                  {p.status_note && (
                    <div className="rounded-xl bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900 ring-1 ring-sky-200/70">
                      {p.status_note}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="text-slate-500 truncate pr-2">
                      {p.building_name} · {p.node_name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigateToDestination(p.target_node_id, p.name)
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 shrink-0 transition"
                    >
                      Navigate
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PLACES DIRECTORY WITH CATEGORY FILTER CHIPS + MULTI-STOP TRIP CHECKLIST */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-extrabold text-slate-950 flex items-center gap-2">
                <Layers className="h-5 w-5 text-cyan-600" />
                Departments, Rooms & Facilities
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Route directly or tap <strong>+ Trip</strong> to chain multiple stops into a single optimized visit checklist
              </p>
            </div>
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                activeCategory === 'all'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              All Places ({placeNodes.length})
            </button>
            {venue.categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  activeCategory === cat.key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>

          {/* Places Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filteredPlaces.map((place) => {
              const isCurrentLoc = visitorLoc?.nodeId === place.id;
              const inTrip = tripStops.some((s) => s.id === place.id);
              return (
                <div
                  key={place.id}
                  className="group overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/85 hover:ring-indigo-500/45 shadow-soft hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
                >
                  <div>
                    <div className="relative h-40 w-full overflow-hidden bg-[#060A16]">
                      {place.photo_url ? (
                        <>
                          <img
                            src={mediaUrl(place.photo_url)}
                            alt={place.name}
                            loading="lazy"
                            className="h-full w-full object-cover hdr-photo transition-transform duration-500 ease-out group-hover:scale-110"
                          />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent" />
                        </>
                      ) : (
                        <IsometricVenueArt
                          accent={venue.accent || '#0ea5e9'}
                          buildings={1}
                          floors={Math.max(2, Math.abs(place.level) + 2)}
                          compact
                        />
                      )}
                      <span className="absolute left-2.5 top-2.5 rounded-lg bg-slate-950/80 px-2.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/15 backdrop-blur-md">
                        {formatLevel(place.level, place.floor_name)}
                      </span>
                      {isCurrentLoc && (
                        <span className="absolute right-2.5 top-2.5 rounded-lg bg-emerald-500 px-2.5 py-0.5 text-[10px] font-extrabold text-slate-950 shadow-sm">
                          You are here
                        </span>
                      )}
                    </div>

                    <div className="p-4">
                      <div className="text-[11px] font-semibold text-indigo-600/90 truncate">
                        {place.building_name}
                      </div>
                      <h3 className="font-display text-sm font-extrabold text-slate-900 truncate mt-0.5 group-hover:text-indigo-600 transition-colors">
                        {place.name}
                      </h3>
                    </div>
                  </div>

                  <div className="px-3.5 pb-3.5 pt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigateToDestination(place.id, place.name)
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-600 transition"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                      Route
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTripStop(place)}
                      title="Add/Remove from Multi-Stop Visit Checklist"
                      className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold ring-1 transition ${
                        inTrip
                          ? 'bg-emerald-600 text-white ring-emerald-600'
                          : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-700'
                      }`}
                    >
                      {inTrip ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      Trip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* FLOATING MULTI-STOP VISIT CHECKLIST DRAWER */}
      {tripStops.length > 0 && (
        <div className="fixed bottom-4 inset-x-4 z-40 mx-auto max-w-4xl rounded-2xl bg-[#070B18]/95 p-4 text-white shadow-2xl ring-1 ring-cyan-400/40 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-cyan-300">
                <ListChecks className="h-4 w-4" />
                Multi-Stop Visit Checklist ({tripStops.length} stop{tripStops.length > 1 ? 's' : ''})
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-emerald-300 font-semibold">
                  Start: {visitorLoc?.name || entranceNode?.name || 'Pick Spot'}
                </span>
                {tripStops.map((st, idx) => (
                  <span
                    key={st.id}
                    className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-white"
                  >
                    {idx + 1}. {st.name}
                    <button
                      type="button"
                      onClick={() => toggleTripStop(st)}
                      className="text-slate-400 hover:text-rose-300"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTripStops([])}
                className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/15"
              >
                Clear
              </button>
              {tripStops.length >= 2 && (
                <button
                  type="button"
                  onClick={() => launchMultiStopTrip(true)}
                  className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition"
                >
                  Optimize & Route
                </button>
              )}
              <button
                type="button"
                onClick={() => launchMultiStopTrip(false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-md hover:from-cyan-300 transition"
              >
                Launch Trip
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Localization Modal */}
      <PhotoLocateModal
        open={locateOpen}
        onClose={() => {
          setLocateOpen(false);
          setDroppedFile(null);
          setQueuedDest(null);
        }}
        venue={venue}
        nodes={graph.nodes}
        initialFile={droppedFile}
        priorNodeId={visitorLoc?.nodeId}
        queuedDestination={queuedDest}
        onConfirmedLocation={handleSpotConfirmed}
      />
    </div>
  );
};
