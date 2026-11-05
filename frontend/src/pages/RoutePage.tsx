import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Camera,
  CheckCircle2,
  CornerUpLeft,
  CornerUpRight,
  Footprints,
  Flag,
  Languages,
  Layers,
  Loader2,
  Map as MapIcon,
  MapPin,
  MoveUp,
  Pause,
  Play,
  ShieldAlert,
  Siren,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { FloorPlan2D } from '../components/FloorPlan2D';
import { PhotoLocateModal, type ConfirmedSpot } from '../components/PhotoLocateModal';
import { ErrorState, Skeleton3D } from '../components/ErrorState';
import { computeRoute, getVenue, getVenueGraph } from '../lib/api';
import {
  formatEta,
  formatLevel,
  useVisitorLocation,
} from '../lib/locationStore';
import type {
  GNode,
  Graph,
  Route,
  RouteProfile,
  Step,
  StepIcon,
  VenueDetail,
} from '../lib/types';

const Venue3D = lazy(() => import('../components/Venue3D'));

type VoiceLang = 'en-IN' | 'hi-IN' | 'ta-IN' | 'te-IN';

const VOICE_LANGUAGES: { code: VoiceLang; label: string }[] = [
  { code: 'en-IN', label: 'English (IN)' },
  { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
  { code: 'te-IN', label: 'తెలుగు (Telugu)' },
];

function localizeInstruction(step: Step, lang: VoiceLang): string {
  if (lang === 'en-IN') {
    return step.distance_m > 0
      ? `${step.instruction}. Walk ${Math.round(step.distance_m)} meters.`
      : step.instruction;
  }
  const dist = Math.round(step.distance_m);
  if (lang === 'hi-IN') {
    if (step.icon === 'arrive') return `आप ${step.name} पर पहुँच गए हैं।`;
    if (step.icon === 'lift') return `लिफ्ट लेकर मंजिल ${step.level} पर ${step.name} की ओर जाएँ।`;
    if (step.icon === 'up' || step.icon === 'down')
      return `सीढ़ियों से मंजिल ${step.level} पर ${step.name} जाएँ।`;
    return `${step.name} की ओर ${dist > 0 ? `${dist} मीटर ` : ''}आगे बढ़ें। ${step.instruction}`;
  }
  if (lang === 'ta-IN') {
    if (step.icon === 'arrive') return `நீங்கள் ${step.name} இடத்தை அடைந்துவிட்டீர்கள்.`;
    if (step.icon === 'lift') return `லிப்ட் மூலம் தளம் ${step.level} இல் உள்ள ${step.name} நோக்கிச் செல்லவும்.`;
    return `${step.name} நோக்கி ${dist > 0 ? `${dist} மீட்டர் ` : ''}செல்லவும். ${step.instruction}`;
  }
  // te-IN
  if (step.icon === 'arrive') return `మీరు ${step.name} వద్దకు చేరుకున్నారు.`;
  if (step.icon === 'lift') return `లిఫ్ట్ ద్వారా అంతస్తు ${step.level} లోని ${step.name} వైపు వెళ్ళండి.`;
  return `${step.name} వైపు ${dist > 0 ? `${dist} మీటర్లు ` : ''}వెళ్ళండి. ${step.instruction}`;
}

function renderStepIcon(icon: StepIcon) {
  switch (icon) {
    case 'start':
      return <MapPin className="h-4 w-4 text-sky-500" />;
    case 'left':
      return <CornerUpLeft className="h-4 w-4 text-indigo-600" />;
    case 'right':
      return <CornerUpRight className="h-4 w-4 text-indigo-600" />;
    case 'up':
      return <ArrowUp className="h-4 w-4 text-amber-600" />;
    case 'down':
      return <ArrowDown className="h-4 w-4 text-amber-600" />;
    case 'lift':
      return <Layers className="h-4 w-4 text-cyan-600" />;
    case 'arrive':
      return <Flag className="h-4 w-4 text-emerald-600" />;
    case 'straight':
    default:
      return <MoveUp className="h-4 w-4 text-slate-700" />;
  }
}

export const RoutePage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setLocation: setVisitorLoc } = useVisitorLocation(slug);

  const fromParam = searchParams.get('from') || '';
  const toParam = searchParams.get('to') || '';
  const profileParam: RouteProfile =
    searchParams.get('profile') === 'wheelchair' ? 'wheelchair' : 'walk';
  const isEmergency = searchParams.get('emergency') === '1';
  const fromEntranceFallback = searchParams.get('fromEntrance') === '1';

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loadingVenue, setLoadingVenue] = useState(true);

  const [route, setRoute] = useState<Route | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Active alternative index (-1 = primary route)
  const [altIndex, setAltIndex] = useState<number>(-1);
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);

  // Twin & Walker State
  const [twinMode, setTwinMode] = useState<'3d' | '2d'>('3d');
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [isPlayingWalker, setIsPlayingWalker] = useState(true);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);

  // Voice Narration State
  const [voiceLang, setVoiceLang] = useState<VoiceLang>('en-IN');
  const [speaking, setSpeaking] = useState(false);

  // Re-check Location Modal & Lightbox
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<{
    url: string;
    caption: string;
  } | null>(null);

  // Load Venue + Graph
  const loadBase = useCallback(async () => {
    if (!slug) return;
    setLoadingVenue(true);
    try {
      const [v, g] = await Promise.all([getVenue(slug), getVenueGraph(slug)]);
      setVenue(v);
      setGraph(g);
    } catch (err) {
      setRouteError(
        err instanceof Error ? err.message : 'Unable to load venue map.',
      );
    } finally {
      setLoadingVenue(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  // Compute Route whenever from / to / profile changes
  const fetchRoute = useCallback(async () => {
    if (!slug || !fromParam || !toParam) return;
    setLoadingRoute(true);
    setRouteError(null);
    setAltIndex(-1);
    setActiveStepIdx(0);
    setScrubProgress(null);
    setIsPlayingWalker(true);

    try {
      const r = await computeRoute(slug, fromParam, toParam, profileParam);
      setRoute(r);
    } catch (err) {
      setRoute(null);
      setRouteError(
        err instanceof Error
          ? err.message
          : 'No accessible route found between these two spots.',
      );
    } finally {
      setLoadingRoute(false);
    }
  }, [slug, fromParam, toParam, profileParam]);

  useEffect(() => {
    void fetchRoute();
  }, [fetchRoute]);

  // Cancel speech synthesis on unmount
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const nodeMap = useMemo(() => {
    const m = new Map<string, GNode>();
    graph?.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph]);

  const placeNodes = useMemo(
    () => (graph ? graph.nodes.filter((n) => n.is_place) : []),
    [graph],
  );

  const originNode = fromParam ? nodeMap.get(fromParam) ?? null : null;
  const destNode = toParam ? nodeMap.get(toParam) ?? null : null;

  const activePath = useMemo(() => {
    if (!route) return [];
    if (altIndex >= 0 && route.alternatives[altIndex]) {
      return route.alternatives[altIndex].path;
    }
    return route.path;
  }, [route, altIndex]);

  const activeDistance =
    route && altIndex >= 0 && route.alternatives[altIndex]
      ? route.alternatives[altIndex].distance_m
      : route?.distance_m ?? 0;

  const activeEta =
    route && altIndex >= 0 && route.alternatives[altIndex]
      ? route.alternatives[altIndex].eta_s
      : route?.eta_s ?? 0;

  const updateRouteParams = (
    nextFrom: string,
    nextTo: string,
    nextProfile: RouteProfile,
  ) => {
    const next = new URLSearchParams(searchParams);
    next.set('from', nextFrom);
    next.set('to', nextTo);
    next.set('profile', nextProfile);
    next.delete('fromEntrance');
    setSearchParams(next);
  };

  const handleStepClick = (step: Step, idx: number) => {
    setActiveStepIdx(idx);
    setAltIndex(-1);
    setIsPlayingWalker(false);

    if (route && route.path.length > 1) {
      const pathIdx = route.path.indexOf(step.node_id);
      if (pathIdx >= 0) {
        setScrubProgress(pathIdx / (route.path.length - 1));
      }
    }
    if (twinMode === '2d') {
      setSelectedLevel(step.level);
    }
  };

  const handlePlayNarration = () => {
    if (!('speechSynthesis' in window) || !route) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const stepsToRead = route.steps;
    if (stepsToRead.length === 0) return;

    setSpeaking(true);
    stepsToRead.forEach((step, idx) => {
      const utter = new SpeechSynthesisUtterance(
        localizeInstruction(step, voiceLang),
      );
      utter.lang = voiceLang;
      utter.rate = 0.98;
      utter.onstart = () => {
        setActiveStepIdx(idx);
      };
      if (idx === stepsToRead.length - 1) {
        utter.onend = () => setSpeaking(false);
        utter.onerror = () => setSpeaking(false);
      }
      window.speechSynthesis.speak(utter);
    });
  };

  const handleRecheckedLocation = (spot: ConfirmedSpot) => {
    setVisitorLoc({
      nodeId: spot.nodeId,
      name: spot.name,
      buildingName: spot.buildingName,
      level: spot.level,
      floorName: spot.floorName,
      source: spot.source,
      updatedAt: Date.now(),
    });
    updateRouteParams(spot.nodeId, toParam, profileParam);
  };

  if (loadingVenue) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm font-medium text-slate-600">
          Preparing route digital twin...
        </p>
      </div>
    );
  }

  if (!venue || !graph) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <ErrorState
          message={routeError || 'Venue data unavailable.'}
          onRetry={() => void loadBase()}
        />
      </div>
    );
  }

  const activeStep = route?.steps[activeStepIdx] ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* =================================================================== */}
      {/* STICKY ROUTE COMMAND HEADER                                         */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070B18]/95 text-white backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3.5 space-y-3">
          {/* Top Row: Back + Origin -> Destination + Re-check Location */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to={`/v/${slug}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-slate-200 ring-1 ring-white/10 hover:bg-white/15 transition"
                title="Back to Venue"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-sm sm:text-base font-display font-extrabold">
                  {isEmergency && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[11px] uppercase tracking-wider text-white">
                      <Siren className="h-3 w-3" /> Emergency
                    </span>
                  )}
                  <span className="text-cyan-300 truncate max-w-[180px] sm:max-w-[240px]">
                    {originNode?.name || 'Select Start'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-white truncate max-w-[180px] sm:max-w-[260px]">
                    {destNode?.name || 'Select Destination'}
                  </span>
                </div>

                {route && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span className="font-bold text-emerald-300">
                      {formatEta(activeEta)}
                    </span>
                    <span>·</span>
                    <span>{Math.round(activeDistance)} m</span>
                    <span>·</span>
                    <span>
                      Floors:{' '}
                      {route.levels.map((l) => formatLevel(l)).join(' → ')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Controls: Re-check My Location + Voice Narration */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRecheckOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-300 ring-1 ring-cyan-400/35 hover:bg-cyan-500/25 transition"
              >
                <Camera className="h-3.5 w-3.5" />
                📷 Re-check my location
              </button>

              {/* Multilingual Voice Guidance */}
              <div className="flex items-center rounded-xl bg-white/[0.07] p-1 ring-1 ring-white/10">
                <Languages className="h-3.5 w-3.5 text-slate-400 ml-2 mr-1" />
                <select
                  value={voiceLang}
                  onChange={(e) => {
                    if (speaking && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                      setSpeaking(false);
                    }
                    setVoiceLang(e.target.value as VoiceLang);
                  }}
                  className="bg-transparent text-xs font-semibold text-slate-200 pr-1 py-1 focus:outline-none"
                  aria-label="Voice guidance language"
                >
                  {VOICE_LANGUAGES.map((vl) => (
                    <option key={vl.code} value={vl.code} className="text-slate-900">
                      {vl.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handlePlayNarration}
                  disabled={!route}
                  className={`ml-1 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    speaking
                      ? 'bg-rose-600 text-white'
                      : 'bg-indigo-600 text-white hover:bg-indigo-500'
                  }`}
                >
                  {speaking ? (
                    <>
                      <VolumeX className="h-3.5 w-3.5" /> Stop
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3.5 w-3.5" /> Voice
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Second Row: Mobility Profile Switcher + Alternative Route Pills + Endpoint Selectors */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-white/10">
            {/* Profile Switcher */}
            <div className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
              <button
                type="button"
                onClick={() => updateRouteParams(fromParam, toParam, 'walk')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  profileParam === 'walk'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Footprints className="h-3.5 w-3.5 text-cyan-500" />
                🚶 Standard Walking
              </button>
              <button
                type="button"
                onClick={() => updateRouteParams(fromParam, toParam, 'wheelchair')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  profileParam === 'wheelchair'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Accessibility className="h-3.5 w-3.5" />
                ♿ Wheelchair / Stretcher (Lift-only)
              </button>
            </div>

            {/* Alternative Routes Pills */}
            {route && route.alternatives.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setAltIndex(-1)}
                  className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    altIndex === -1
                      ? 'bg-cyan-500/25 text-cyan-200 ring-1 ring-cyan-400/50'
                      : 'bg-white/[0.05] text-slate-400 hover:text-white'
                  }`}
                >
                  Fastest ({Math.round(route.distance_m)}m · {formatEta(route.eta_s)})
                </button>
                {route.alternatives.map((alt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAltIndex(i)}
                    className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      altIndex === i
                        ? 'bg-cyan-500/25 text-cyan-200 ring-1 ring-cyan-400/50'
                        : 'bg-white/[0.05] text-slate-400 hover:text-white'
                    }`}
                  >
                    {alt.label} ({Math.round(alt.distance_m)}m · {formatEta(alt.eta_s)})
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* NOTICES / CLOSURE ALERTS / MISSING PARAMS                           */}
      {/* =================================================================== */}
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-4 space-y-3">
        {fromEntranceFallback && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-900 ring-1 ring-rose-200">
            <div className="flex items-center gap-2 font-medium">
              <Siren className="h-4 w-4 text-rose-600 shrink-0" />
              <span>
                Your location wasn't set yet, so this emergency route starts from{' '}
                <strong>{originNode?.name || 'Main Entrance'}</strong>. Upload a photo if you are standing elsewhere!
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRecheckOpen(true)}
              className="rounded-lg bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-500"
            >
              Upload My Spot
            </button>
          </div>
        )}

        {route && (route.closures_avoided > 0 || route.notice) && (
          <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-950 ring-1 ring-amber-200">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Live Hazard Bypass Active: </span>
              {route.notice ||
                `Automatically avoided ${route.closures_avoided} closed corridor/lift segment${route.closures_avoided > 1 ? 's' : ''}.`}
            </div>
          </div>
        )}

        {(!fromParam || !toParam) && (
          <div className="card p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Starting Spot</label>
              <select
                value={fromParam}
                onChange={(e) =>
                  updateRouteParams(e.target.value, toParam, profileParam)
                }
                className="input"
              >
                <option value="">Choose start...</option>
                {placeNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({formatLevel(n.level, n.floor_name)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Destination</label>
              <select
                value={toParam}
                onChange={(e) =>
                  updateRouteParams(fromParam, e.target.value, profileParam)
                }
                className="input"
              >
                <option value="">Choose destination...</option>
                {placeNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({formatLevel(n.level, n.floor_name)})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* SPLIT NAVIGATION WORKSPACE: STEPS LIST + 3D/2D INTERACTIVE TWIN     */}
      {/* =================================================================== */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-4">
        {loadingRoute ? (
          <div className="card p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
            <p className="mt-3 text-sm font-medium text-slate-600">
              Computing optimal {profileParam === 'wheelchair' ? 'lift-only accessible' : 'multi-floor'} route...
            </p>
          </div>
        ) : routeError ? (
          <div className="space-y-4">
            <ErrorState
              title="No Accessible Path Available"
              message={routeError}
              onRetry={() => void fetchRoute()}
            />
            {profileParam === 'wheelchair' && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => updateRouteParams(fromParam, toParam, 'walk')}
                  className="btn-ghost text-xs"
                >
                  Switch to Standard Walking Profile
                </button>
              </div>
            )}
          </div>
        ) : route ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* RIGHT ON DESKTOP / TOP ON MOBILE: 3D/2D ROUTE TWIN */}
            <div className="lg:col-span-7 lg:order-2 lg:sticky lg:top-36 space-y-3">
              {/* Twin Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-slate-200/80 shadow-soft">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isPlayingWalker) {
                        setIsPlayingWalker(false);
                      } else {
                        setScrubProgress(null);
                        setIsPlayingWalker(true);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
                  >
                    {isPlayingWalker ? (
                      <>
                        <Pause className="h-3.5 w-3.5 text-cyan-400" /> Pause Walker
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 text-emerald-400" /> Animate Route
                      </>
                    )}
                  </button>

                  {twinMode === '3d' && (
                    <select
                      value={String(selectedLevel)}
                      onChange={(e) =>
                        setSelectedLevel(
                          e.target.value === 'all' ? 'all' : Number(e.target.value),
                        )
                      }
                      className="rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none"
                      aria-label="Filter 3D floor"
                    >
                      <option value="all">All Floors</option>
                      {route.levels.map((lvl) => (
                        <option key={lvl} value={String(lvl)}>
                          {formatLevel(lvl)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 3D / 2D Switcher */}
                <div className="flex items-center rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setTwinMode('3d')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      twinMode === '3d'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600'
                    }`}
                  >
                    <Box className="h-3.5 w-3.5 text-indigo-600" />
                    3D Route
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTwinMode('2d');
                      if (selectedLevel === 'all') {
                        setSelectedLevel(activeStep?.level ?? route.levels[0] ?? 0);
                      }
                    }}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      twinMode === '2d'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600'
                    }`}
                  >
                    <MapIcon className="h-3.5 w-3.5 text-cyan-600" />
                    2D Plan
                  </button>
                </div>
              </div>

              {/* Map Canvas */}
              <div className="h-[390px] sm:h-[490px] w-full">
                {twinMode === '3d' ? (
                  <Suspense fallback={<Skeleton3D />}>
                    <Venue3D
                      venue={venue}
                      graph={graph}
                      selectedLevel={selectedLevel}
                      selectedNodeId={activeStep?.node_id}
                      startNodeId={route.from_node}
                      endNodeId={route.to_node}
                      routePath={activePath}
                      walkerProgress={scrubProgress}
                      isPlayingWalker={isPlayingWalker}
                      onSelectNode={(n) => {
                        const idx = route.steps.findIndex((s) => s.node_id === n.id);
                        if (idx >= 0) handleStepClick(route.steps[idx], idx);
                      }}
                    />
                  </Suspense>
                ) : (
                  <FloorPlan2D
                    venue={venue}
                    graph={graph}
                    selectedLevel={
                      typeof selectedLevel === 'number'
                        ? selectedLevel
                        : activeStep?.level ?? route.levels[0] ?? 0
                    }
                    onChangeLevel={(lvl) => setSelectedLevel(lvl)}
                    selectedNodeId={activeStep?.node_id}
                    startNodeId={route.from_node}
                    endNodeId={route.to_node}
                    routePath={activePath}
                    walkerNodeId={activeStep?.node_id}
                    onSelectNode={(n) => {
                      const idx = route.steps.findIndex((s) => s.node_id === n.id);
                      if (idx >= 0) handleStepClick(route.steps[idx], idx);
                    }}
                  />
                )}
              </div>
            </div>

            {/* LEFT ON DESKTOP / BOTTOM ON MOBILE: VISUAL TURN-BY-TURN STEPS */}
            <div className="lg:col-span-5 lg:order-1 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="font-display text-base font-extrabold text-slate-900">
                  Visual Turn-by-Turn Steps ({route.steps.length})
                </h2>
                <span className="text-xs text-slate-500">
                  Tap any step to inspect on map
                </span>
              </div>

              {altIndex >= 0 && (
                <div className="rounded-xl bg-cyan-50 px-3.5 py-2 text-xs text-cyan-900 ring-1 ring-cyan-200 flex items-center justify-between">
                  <span>
                    Previewing alternative path:{' '}
                    <strong>{route.alternatives[altIndex]?.label}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAltIndex(-1)}
                    className="font-bold underline"
                  >
                    Restore Primary
                  </button>
                </div>
              )}

              <div className="space-y-2.5">
                {route.steps.map((step, idx) => {
                  const isActive = idx === activeStepIdx;
                  const isLast = idx === route.steps.length - 1;
                  return (
                    <div
                      key={`${step.index}-${step.node_id}`}
                      onClick={() => handleStepClick(step, idx)}
                      className={`cursor-pointer rounded-2xl p-4 transition-all ${
                        isActive
                          ? 'bg-white ring-2 ring-indigo-600 shadow-lift'
                          : 'bg-white/90 ring-1 ring-slate-200/80 hover:bg-white hover:ring-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${
                            isLast
                              ? 'bg-emerald-50 ring-emerald-200'
                              : isActive
                                ? 'bg-indigo-50 ring-indigo-200'
                                : 'bg-slate-50 ring-slate-200'
                          }`}
                        >
                          {renderStepIcon(step.icon)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                              Step {idx + 1} · {formatLevel(step.level)}
                            </span>
                            {step.distance_m > 0 && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                {Math.round(step.distance_m)} m
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-sm font-bold text-slate-900 leading-snug">
                            {step.instruction}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">{step.name}</p>

                          {/* Reference Photo Thumbnail */}
                          {step.photo_url && (
                            <div
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setLightboxUrl({
                                  url: step.photo_url!,
                                  caption: `${step.name} (${formatLevel(step.level)})`,
                                });
                              }}
                              className="mt-3 group relative flex items-center gap-3 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200/80 hover:ring-indigo-400 transition"
                            >
                              <img
                                src={step.photo_url}
                                alt={step.name}
                                loading="lazy"
                                className="h-14 w-20 rounded-lg object-cover shrink-0 bg-slate-900"
                              />
                              <div className="min-w-0">
                                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Look for this spot
                                </div>
                                <div className="text-xs text-slate-600 truncate">
                                  Tap to enlarge landmark photo
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* Re-check My Location Modal */}
      <PhotoLocateModal
        open={recheckOpen}
        onClose={() => setRecheckOpen(false)}
        venue={venue}
        nodes={graph.nodes}
        queuedDestination={
          destNode ? { nodeId: destNode.id, name: destNode.name } : null
        }
        onConfirmedLocation={handleRecheckedLocation}
      />

      {/* Landmark Photo Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl w-full overflow-hidden rounded-3xl bg-slate-900 ring-1 ring-white/20 shadow-2xl"
          >
            <img
              src={lightboxUrl.url}
              alt={lightboxUrl.caption}
              className="max-h-[75vh] w-full object-contain bg-black"
            />
            <div className="flex items-center justify-between px-5 py-3.5 text-white">
              <span className="text-sm font-bold">{lightboxUrl.caption}</span>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
