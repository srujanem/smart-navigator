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
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bed,
  Box,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Eye,
  Footprints,
  Flag,
  Languages,
  Layers,
  ListChecks,
  Loader2,
  Map as MapIcon,
  MapPin,
  Maximize2,
  MoveUp,
  Pause,
  Play,
  Plus,
  Share2,
  ShieldAlert,
  Siren,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  ZoomIn,
} from 'lucide-react';
import { FloorPlan2D } from '../components/FloorPlan2D';
import { IsometricVenueArt } from '../components/VenueCard';
import { PhotoLocateModal, type ConfirmedSpot } from '../components/PhotoLocateModal';
import { ErrorState, Skeleton3D } from '../components/ErrorState';
import {
  computeMultiStopRoute,
  computeNearestRoute,
  computeRoute,
  getVenue,
  getVenueGraph,
  mediaUrl,
} from '../lib/api';
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

type VoiceLang = 'en-IN' | 'kn-IN' | 'hi-IN' | 'ta-IN' | 'te-IN';

const VOICE_LANGUAGES: { code: VoiceLang; label: string }[] = [
  { code: 'en-IN', label: 'English (IN)' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
  { code: 'te-IN', label: 'తెలుగు (Telugu)' },
];

function localizeInstruction(step: Step, lang: VoiceLang): string {
  const dist = Math.round(step.distance_m);
  if (lang === 'en-IN') {
    return dist > 0
      ? `${step.instruction}. Walk ${dist} meters.`
      : step.instruction;
  }

  if (lang === 'kn-IN') {
    if (step.icon === 'start') return `${step.name} ನಿಂದ ಪ್ರಯಾಣ ಪ್ರಾರಂಭಿಸಿ.`;
    if (step.icon === 'arrive') return `ನೀವು ${step.name} ತಲುಪಿದ್ದೀರಿ.`;
    if (step.icon === 'lift')
      return `ಲಿಫ್ಟ್ ಮೂಲಕ ಮಹಡಿ ${step.level} ರಲ್ಲಿರುವ ${step.name} ಕಡೆಗೆ ಹೋಗಿ.`;
    if (step.icon === 'up')
      return `ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಮೇಲಿನ ಮಹಡಿ ${step.level} ಕ್ಕೆ ${step.name} ಕಡೆಗೆ ಹೋಗಿ.`;
    if (step.icon === 'down')
      return `ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಕೆಳಗಿನ ಮಹಡಿ ${step.level} ಕ್ಕೆ ${step.name} ಕಡೆಗೆ ಇಳಿಯಿರಿ.`;
    if (step.icon === 'left')
      return `ಎಡಕ್ಕೆ ತಿರುಗಿ ${dist > 0 ? `${dist} ಮೀಟರ್ ` : ''}${step.name} ಕಡೆಗೆ ನಡೆಯಿರಿ.`;
    if (step.icon === 'right')
      return `ಬಲಕ್ಕೆ ತಿರುಗಿ ${dist > 0 ? `${dist} ಮೀಟರ್ ` : ''}${step.name} ಕಡೆಗೆ ನಡೆಯಿರಿ.`;
    return `${step.name} ಕಡೆಗೆ ${dist > 0 ? `${dist} ಮೀಟರ್ ` : ''}ನೇರವಾಗಿ ಮುಂದುವರಿಯಿರಿ.`;
  }

  if (lang === 'hi-IN') {
    if (step.icon === 'start') return `${step.name} से चलना शुरू करें।`;
    if (step.icon === 'arrive') return `आप ${step.name} पर पहुँच गए हैं।`;
    if (step.icon === 'lift')
      return `लिफ्ट लेकर मंजिल ${step.level} पर ${step.name} की ओर जाएँ।`;
    if (step.icon === 'up')
      return `सीढ़ियों से ऊपर मंजिल ${step.level} पर ${step.name} जाएँ।`;
    if (step.icon === 'down')
      return `सीढ़ियों से नीचे मंजिल ${step.level} पर ${step.name} जाएँ।`;
    if (step.icon === 'left')
      return `बाएँ मुड़ें और ${dist > 0 ? `${dist} मीटर ` : ''}${step.name} की ओर चलें।`;
    if (step.icon === 'right')
      return `दाएँ मुड़ें और ${dist > 0 ? `${dist} मीटर ` : ''}${step.name} की ओर चलें।`;
    return `${step.name} की ओर ${dist > 0 ? `${dist} मीटर ` : ''}सीधे आगे बढ़ें।`;
  }

  if (lang === 'ta-IN') {
    if (step.icon === 'start') return `${step.name} இடத்திலிருந்து தொடங்கவும்.`;
    if (step.icon === 'arrive') return `நீங்கள் ${step.name} இடத்தை அடைந்துவிட்டீர்கள்.`;
    if (step.icon === 'lift')
      return `லிப்ட் மூலம் தளம் ${step.level} இல் உள்ள ${step.name} நோக்கிச் செல்லவும்.`;
    if (step.icon === 'up' || step.icon === 'down')
      return `படிக்கட்டுகள் வழியாக தளம் ${step.level} இல் உள்ள ${step.name} செல்லவும்.`;
    if (step.icon === 'left')
      return `இடதுபுறம் திரும்பி ${dist > 0 ? `${dist} மீட்டர் ` : ''}${step.name} நோக்கி நடக்கவும்.`;
    if (step.icon === 'right')
      return `வலதுபுறம் திரும்பி ${dist > 0 ? `${dist} மீட்டர் ` : ''}${step.name} நோக்கி நடக்கவும்.`;
    return `${step.name} நோக்கி ${dist > 0 ? `${dist} மீட்டர் ` : ''}நேராகச் செல்லவும்.`;
  }

  // te-IN
  if (step.icon === 'start') return `${step.name} నుండి ప్రారంభించండి.`;
  if (step.icon === 'arrive') return `మీరు ${step.name} వద్దకు చేరుకున్నారు.`;
  if (step.icon === 'lift')
    return `లిఫ్ట్ ద్వారా అంతస్తు ${step.level} లోని ${step.name} వైపు వెళ్ళండి.`;
  if (step.icon === 'up' || step.icon === 'down')
    return `మెట్ల ద్వారా అంతస్తు ${step.level} లోని ${step.name} కి వెళ్ళండి.`;
  if (step.icon === 'left')
    return `ఎడమవైపు తిరిగి ${dist > 0 ? `${dist} మీటర్లు ` : ''}${step.name} వైపు నడవండి.`;
  if (step.icon === 'right')
    return `కుడివైపు తిరిగి ${dist > 0 ? `${dist} మీటర్లు ` : ''}${step.name} వైపు నడవండి.`;
  return `${step.name} వైపు ${dist > 0 ? `${dist} మీటర్లు ` : ''}నేరుగా వెళ్ళండి.`;
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
  const { location: visitorLoc, setLocation: setVisitorLoc } = useVisitorLocation(slug);

  const fromParam = searchParams.get('from') || '';
  const toParam = searchParams.get('to') || '';
  const stopsParam = searchParams.get('stops') || '';
  const optimizeParam = searchParams.get('optimize') === '1';
  const avoidCrowdsParam = searchParams.get('avoidCrowds') === '1';
  const rawProfile = searchParams.get('profile');
  const profileParam: RouteProfile =
    rawProfile === 'wheelchair'
      ? 'wheelchair'
      : rawProfile === 'stretcher'
        ? 'stretcher'
        : 'walk';
  const isEmergency = searchParams.get('emergency') === '1';
  const fromEntranceFallback = searchParams.get('fromEntrance') === '1';

  const multiStops = useMemo(() => {
    if (!stopsParam.trim()) return [];
    return stopsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [stopsParam]);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loadingVenue, setLoadingVenue] = useState(true);

  const [route, setRoute] = useState<Route | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Multi-stop quick add selector
  const [extraStopId, setExtraStopId] = useState('');
  const [copiedRouteLink, setCopiedRouteLink] = useState(false);

  // Active alternative index (-1 = primary route)
  const [altIndex, setAltIndex] = useState<number>(-1);
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);
  const [mobileViewMode, setMobileViewMode] = useState<'all' | 'street' | 'map' | 'steps'>('all');

  // Twin & Walker State
  const [twinMode, setTwinMode] = useState<'3d' | '2d'>('3d');
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [isPlayingWalker, setIsPlayingWalker] = useState(true);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);

  // Voice Narration & Haptic Guidance State
  const [voiceLang, setVoiceLang] = useState<VoiceLang>('en-IN');
  const [speaking, setSpeaking] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [hapticPulseLabel, setHapticPulseLabel] = useState<string | null>(null);

  // Re-check Location Modal & Lightbox
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [showStreetStage, setShowStreetStage] = useState(true);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
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

  // Compute Route whenever endpoints, stops, profile, or crowd avoidance changes
  const fetchRoute = useCallback(async () => {
    if (!slug) return;
    const headingHint =
      visitorLoc && visitorLoc.nodeId === (multiStops[0] || fromParam)
        ? visitorLoc.headingDeg ?? null
        : null;

    if (multiStops.length >= 2) {
      setLoadingRoute(true);
      setRouteError(null);
      setAltIndex(-1);
      setActiveStepIdx(0);
      setScrubProgress(null);
      setIsPlayingWalker(true);
      try {
        const r = await computeMultiStopRoute(slug, multiStops, profileParam, {
          optimize: optimizeParam,
          avoidCrowds: avoidCrowdsParam,
          headingDeg: headingHint,
        });
        setRoute(r);
      } catch (err) {
        setRoute(null);
        setRouteError(
          err instanceof Error
            ? err.message
            : 'No accessible multi-stop route found between these stops.',
        );
      } finally {
        setLoadingRoute(false);
      }
      return;
    }

    if (!fromParam || !toParam) return;
    setLoadingRoute(true);
    setRouteError(null);
    setAltIndex(-1);
    setActiveStepIdx(0);
    setScrubProgress(null);
    setIsPlayingWalker(true);

    try {
      const r = await computeRoute(slug, fromParam, toParam, profileParam, {
        avoidCrowds: avoidCrowdsParam,
        headingDeg: headingHint,
      });
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
  }, [
    slug,
    fromParam,
    toParam,
    multiStops,
    optimizeParam,
    avoidCrowdsParam,
    profileParam,
    visitorLoc,
  ]);

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

  const effectiveFromId = route?.from_node || multiStops[0] || fromParam;
  const effectiveToId =
    route?.to_node ||
    (multiStops.length >= 2 ? multiStops[multiStops.length - 1] : toParam);

  const originNode = effectiveFromId ? nodeMap.get(effectiveFromId) ?? null : null;
  const destNode = effectiveToId ? nodeMap.get(effectiveToId) ?? null : null;

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
    extra?: { avoidCrowds?: boolean; stops?: string[]; optimize?: boolean },
  ) => {
    const next = new URLSearchParams(searchParams);
    next.set('from', nextFrom);
    next.set('to', nextTo);
    next.set('profile', nextProfile);
    next.delete('fromEntrance');

    if (extra?.avoidCrowds !== undefined) {
      if (extra.avoidCrowds) next.set('avoidCrowds', '1');
      else next.delete('avoidCrowds');
    }
    if (extra?.stops !== undefined) {
      if (extra.stops.length >= 2) {
        next.set('stops', extra.stops.join(','));
        next.set('from', extra.stops[0]);
        next.set('to', extra.stops[extra.stops.length - 1]);
      } else {
        next.delete('stops');
        next.delete('optimize');
      }
    }
    if (extra?.optimize !== undefined) {
      if (extra.optimize) next.set('optimize', '1');
      else next.delete('optimize');
    }
    setSearchParams(next);
  };

  const handleAddStopToRoute = (nodeId: string) => {
    if (!nodeId) return;
    const baseStops =
      multiStops.length >= 2
        ? [...multiStops]
        : [fromParam, toParam].filter(Boolean);
    if (baseStops.includes(nodeId) || baseStops.length >= 6) return;
    const nextStops = [...baseStops, nodeId];
    setExtraStopId('');
    updateRouteParams(nextStops[0], nextStops[nextStops.length - 1], profileParam, {
      stops: nextStops,
    });
  };

  const handleRemoveStop = (idxToRemove: number) => {
    if (multiStops.length <= 2) {
      updateRouteParams(fromParam, toParam, profileParam, { stops: [] });
      return;
    }
    const nextStops = multiStops.filter((_, i) => i !== idxToRemove);
    updateRouteParams(nextStops[0], nextStops[nextStops.length - 1], profileParam, {
      stops: nextStops,
    });
  };

  const handleShareRoute = async (viaWhatsApp = false) => {
    const shareUrl = window.location.href;
    const text = `Follow this indoor route from ${originNode?.name || 'Start'} to ${destNode?.name || 'Destination'} at ${venue?.name || slug}: ${shareUrl}`;
    if (viaWhatsApp) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedRouteLink(true);
      setTimeout(() => setCopiedRouteLink(false), 2500);
    } catch {
      // Ignore
    }
  };

  const triggerHapticForStep = useCallback(
    (step: Step | undefined | null) => {
      if (!step || !hapticsEnabled) return;
      let pattern: number[] = [40];
      let cue = '📳 1 Short Tick · Proceed Straight';
      if (step.icon === 'left') {
        pattern = [95];
        cue = '📳 1 Crisp Pulse · Turn Left';
      } else if (step.icon === 'right') {
        pattern = [80, 55, 80];
        cue = '📳 2 Pulses · Turn Right';
      } else if (step.icon === 'lift' || step.icon === 'up' || step.icon === 'down') {
        pattern = [70, 45, 70, 45, 130];
        cue = '📳 3 Pulses · Floor Transition';
      } else if (step.icon === 'arrive') {
        pattern = [220, 80, 220];
        cue = '📳 Long Pulse · Destination Reached';
      }
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(pattern);
        }
      } catch {
        // Ignore on desktop browsers without vibration hardware
      }
      setHapticPulseLabel(cue);
    },
    [hapticsEnabled],
  );

  useEffect(() => {
    if (!route || !route.steps[activeStepIdx]) return;
    triggerHapticForStep(route.steps[activeStepIdx]);
  }, [activeStepIdx, route, triggerHapticForStep]);

  const handleEmergencyFromHere = async () => {
    if (!slug || !venue) return;
    const currentStepNodeId =
      route?.steps[activeStepIdx]?.node_id || effectiveFromId;
    if (!currentStepNodeId) return;

    if (venue.emergency_node_id && venue.emergency_node_id !== currentStepNodeId) {
      const next = new URLSearchParams(searchParams);
      next.set('from', currentStepNodeId);
      next.set('to', venue.emergency_node_id);
      next.set('emergency', '1');
      next.delete('stops');
      setSearchParams(next);
      return;
    }

    try {
      const nearest = await computeNearestRoute(
        slug,
        currentStepNodeId,
        'exit',
        profileParam,
      );
      const next = new URLSearchParams(searchParams);
      next.set('from', nearest.from_node);
      next.set('to', nearest.to_node);
      next.set('emergency', '1');
      next.delete('stops');
      setSearchParams(next);
    } catch {
      // Fallback if already at exit
    }
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
      utter.rate = 0.96;
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
      headingDeg: spot.headingDeg ?? null,
      source: spot.source,
      updatedAt: Date.now(),
    });
    if (multiStops.length >= 2) {
      const updated = [spot.nodeId, ...multiStops.slice(1)];
      updateRouteParams(updated[0], updated[updated.length - 1], profileParam, {
        stops: updated,
      });
    } else {
      updateRouteParams(spot.nodeId, toParam, profileParam);
    }
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
  const activeStepNode = activeStep ? nodeMap.get(activeStep.node_id) : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* =================================================================== */}
      {/* STICKY ROUTE COMMAND HEADER                                         */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070B18]/95 text-white backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3.5 space-y-3">
          {/* Top Row: Back + Origin -> Destination + Re-check + Share + Voice */}
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
                  {route?.stops && route.stops.length > 2 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/30 px-2 py-0.5 text-[11px] text-indigo-200 ring-1 ring-indigo-400/40">
                      {route.stops.length}-Stop Trip
                    </span>
                  )}
                  <span className="text-cyan-300 truncate max-w-[160px] sm:max-w-[220px]">
                    {originNode?.name || 'Select Start'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-white truncate max-w-[160px] sm:max-w-[240px]">
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

            {/* Right Controls: Emergency Exit + Re-check My Location + Haptics + Share + Voice Narration */}
            <div className="flex flex-wrap items-center gap-2">
              {!isEmergency && (
                <button
                  type="button"
                  onClick={() => void handleEmergencyFromHere()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white shadow-md shadow-rose-600/35 ring-1 ring-rose-400/50 hover:bg-rose-500 transition"
                  title="Reroute immediately from your current step to the nearest emergency exit"
                >
                  <Siren className="h-3.5 w-3.5" />
                  🚨 Emergency Exit
                </button>
              )}

              <button
                type="button"
                onClick={() => setRecheckOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-300 ring-1 ring-cyan-400/35 hover:bg-cyan-500/25 transition"
              >
                <Camera className="h-3.5 w-3.5" />
                📷 Re-check spot
              </button>

              <button
                type="button"
                onClick={() => setHapticsEnabled((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold ring-1 transition ${
                  hapticsEnabled
                    ? 'bg-amber-500/15 text-amber-200 ring-amber-400/35 hover:bg-amber-500/25'
                    : 'bg-white/[0.06] text-slate-400 ring-white/10 hover:text-white'
                }`}
                title="Toggle Haptic Turn Vibrations (1 pulse=Left, 2=Right, 3=Lift/Stairs)"
              >
                {hapticsEnabled ? '📳 Haptics On' : '📴 Haptics Off'}
              </button>

              <button
                type="button"
                onClick={() => void handleShareRoute(false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-2.5 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/15 transition"
                title="Copy shareable route link"
              >
                {copiedRouteLink ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5 text-cyan-400" /> Share
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleShareRoute(true)}
                className="hidden sm:inline-flex items-center gap-1 rounded-xl bg-emerald-600/90 px-2.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition"
              >
                WhatsApp
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

          {hapticsEnabled && hapticPulseLabel && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-400/25">
              <span>{hapticPulseLabel}</span>
              <span className="text-[10px] text-amber-300/80 hidden sm:inline">
                Eyes-Free Tactile Guidance · 1 Pulse=Left · 2=Right · 3=Lift/Stairs
              </span>
            </div>
          )}

          {/* Second Row: 3 Mobility Profiles + Avoid Crowds Toggle + Alternative Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-white/10">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar w-full sm:w-auto py-0.5">
              {/* Profile Switcher */}
              <div className="flex shrink-0 items-center gap-1 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
                <button
                  type="button"
                  onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'walk')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    profileParam === 'walk'
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Footprints className="h-3.5 w-3.5 text-cyan-500" />
                  Walking
                </button>
                <button
                  type="button"
                  onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'wheelchair')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    profileParam === 'wheelchair'
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Accessibility className="h-3.5 w-3.5" />
                  Wheelchair (Lift)
                </button>
                <button
                  type="button"
                  onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'stretcher')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    profileParam === 'stretcher'
                      ? 'bg-amber-400 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Bed className="h-3.5 w-3.5" />
                  Stretcher-Wide
                </button>
              </div>

              {/* Avoid Crowded Corridors Toggle */}
              <button
                type="button"
                onClick={() =>
                  updateRouteParams(effectiveFromId, effectiveToId, profileParam, {
                    avoidCrowds: !avoidCrowdsParam,
                  })
                }
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ring-1 whitespace-nowrap transition ${
                  avoidCrowdsParam
                    ? 'bg-violet-500/25 text-violet-200 ring-violet-400/50'
                    : 'bg-white/[0.05] text-slate-300 ring-white/10 hover:text-white'
                }`}
              >
                <Users className="h-3.5 w-3.5 text-violet-400" />
                {avoidCrowdsParam ? 'Avoiding Crowds ✓' : 'Avoid Crowds'}
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
      {/* NOTICES / OFFLINE MODE / CAMERA HEADING / MULTI-STOP PLANNER        */}
      {/* =================================================================== */}
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-4 space-y-3">
        {route?.offline_fallback && (
          <div className="flex items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-xs text-cyan-200 ring-1 ring-cyan-400/40">
            <WifiOff className="h-4 w-4 text-cyan-400 shrink-0" />
            <div>
              <strong className="text-white">Offline Basement Mode Active:</strong>{' '}
              Server unreachable — computing 3D A* path directly on your device from cached venue graph!
            </div>
          </div>
        )}

        {fromEntranceFallback && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-900 ring-1 ring-rose-200">
            <div className="flex items-center gap-2 font-medium">
              <Siren className="h-4 w-4 text-rose-600 shrink-0" />
              <span>
                Your location wasn't set yet, so this route starts from{' '}
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

        {route?.orientation_hint && (
          <div className="flex items-center gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-xs text-indigo-950 ring-1 ring-indigo-200">
            <Compass className="h-4 w-4 text-indigo-600 shrink-0" />
            <div>
              <span className="font-bold">Camera Facing Orientation: </span>
              {route.orientation_hint}
            </div>
          </div>
        )}

        {route && (route.closures_avoided > 0 || route.notice) && (
          <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-950 ring-1 ring-amber-200">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Smart Routing Notice: </span>
              {route.notice ||
                `Automatically avoided ${route.closures_avoided} closed corridor/lift segment${route.closures_avoided > 1 ? 's' : ''}.`}
            </div>
          </div>
        )}

        {/* MULTI-STOP VISIT CHECKLIST BAR */}
        {route && (
          <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/80 shadow-soft flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 font-extrabold text-slate-800 mr-1">
                <ListChecks className="h-4 w-4 text-indigo-600" />
                Visit Stops:
              </span>
              {(route.stops && route.stops.length >= 2
                ? route.stops
                : [route.from_node, route.to_node]
              ).map((stId, idx, arr) => {
                const nd = nodeMap.get(stId);
                return (
                  <React.Fragment key={`${stId}-${idx}`}>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-800 ring-1 ring-slate-200/80">
                      <span className="text-[10px] font-bold text-indigo-600">
                        {idx === 0 ? 'Start' : idx === arr.length - 1 ? 'End' : `#${idx}`}
                      </span>
                      {nd?.name || stId}
                      {arr.length > 2 && idx > 0 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStop(idx)}
                          className="text-slate-400 hover:text-rose-600 ml-0.5"
                          title="Remove stop"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                    {idx < arr.length - 1 && (
                      <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Plus className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={extraStopId}
                  onChange={(e) => handleAddStopToRoute(e.target.value)}
                  className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Add another stop to visit checklist"
                >
                  <option value="">+ Add stop to checklist...</option>
                  {placeNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({formatLevel(n.level)})
                    </option>
                  ))}
                </select>
              </div>

              {multiStops.length >= 3 && (
                <button
                  type="button"
                  onClick={() =>
                    updateRouteParams(effectiveFromId, effectiveToId, profileParam, {
                      stops: multiStops,
                      optimize: !optimizeParam,
                    })
                  }
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold ring-1 transition ${
                    optimizeParam
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100'
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  {optimizeParam ? 'Order Optimized ✓' : 'Optimize Stop Order'}
                </button>
              )}
            </div>
          </div>
        )}

        {(!fromParam || !toParam) && multiStops.length < 2 && (
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
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-4 pb-36 sm:pb-8">
        {loadingRoute ? (
          <div className="card p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
            <p className="mt-3 text-sm font-medium text-slate-600">
              Computing optimal{' '}
              {profileParam === 'stretcher'
                ? 'stretcher-wide lift'
                : profileParam === 'wheelchair'
                  ? 'lift-only accessible'
                  : 'multi-floor'}{' '}
              route...
            </p>
          </div>
        ) : routeError ? (
          <div className="space-y-4">
            <ErrorState
              title="No Accessible Path Available"
              message={routeError}
              onRetry={() => void fetchRoute()}
            />
            {profileParam !== 'walk' && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'walk')}
                  className="btn-ghost text-xs"
                >
                  Switch to Standard Walking Profile
                </button>
              </div>
            )}
          </div>
        ) : route ? (
          <div>
            {/* Mobile View Switcher Tabs (Only on small screens) */}
            <div className="lg:hidden flex items-center justify-between rounded-2xl bg-white p-1 ring-1 ring-slate-200/90 shadow-soft mb-3">
              <button
                type="button"
                onClick={() => setMobileViewMode('all')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                  mobileViewMode === 'all'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileViewMode('street');
                  setShowStreetStage(true);
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                  mobileViewMode === 'street'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📷 Street View
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('map')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                  mobileViewMode === 'map'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🗺️ {twinMode === '3d' ? '3D' : '2D'} Map
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('steps')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                  mobileViewMode === 'steps'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📋 Steps
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* RIGHT ON DESKTOP / TOP ON MOBILE: HERO 3D/2D TWIN & STREET-VIEW WORKSPACE */}
              <div
                className={`lg:col-span-7 lg:order-2 lg:sticky lg:top-24 space-y-3 ${
                  mobileViewMode === 'steps' ? 'hidden lg:block' : ''
                }`}
              >
                {/* Unified Workspace Header Ribbon */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-2 ring-1 ring-slate-200/80 shadow-soft">
                  <div className="flex items-center gap-1.5">
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
                          <Pause className="h-3.5 w-3.5 text-cyan-400" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 text-emerald-400" /> Play
                        </>
                      )}
                    </button>

                    {twinMode === '3d' && (
                      <select
                        value={String(selectedLevel)}
                        onChange={(e) =>
                          setSelectedLevel(
                            e.target.value === 'all'
                              ? 'all'
                              : Number(e.target.value),
                          )
                        }
                        className="rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none ring-1 ring-slate-200/60"
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

                  {/* 3-Way Mode Switcher: 3D Twin | 2D Plan | Cinema Street-View */}
                  <div className="flex items-center rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTwinMode('3d');
                        setShowStreetStage(false);
                      }}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                        twinMode === '3d' && !showStreetStage
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
                        setShowStreetStage(false);
                        if (selectedLevel === 'all') {
                          setSelectedLevel(
                            activeStep?.level ?? route.levels[0] ?? 0,
                          );
                        }
                      }}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                        twinMode === '2d' && !showStreetStage
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <MapIcon className="h-3.5 w-3.5 text-cyan-600" />
                      2D Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowStreetStage(true)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                        showStreetStage
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Eye className="h-3.5 w-3.5 text-emerald-600" />
                      Street View
                    </button>
                  </div>
                </div>

                {/* FULL-BLEED WORKSPACE STAGE (Never squished, never cut off) */}
                <div className="relative h-[480px] sm:h-[540px] lg:h-[calc(100vh-14rem)] min-h-[460px] max-h-[660px] w-full overflow-hidden rounded-3xl bg-[#060A16] ring-1 ring-slate-900/15 shadow-2xl">
                  {showStreetStage ? (
                    /* CINEMA STREET-VIEW FULL STAGE */
                    <div className="relative h-full w-full overflow-hidden flex flex-col justify-between">
                      {/* Media Image / Video */}
                      <div className="absolute inset-0">
                        {activeStepNode?.video_url ? (
                          <video
                            src={mediaUrl(activeStepNode.video_url)}
                            poster={
                              activeStep?.photo_url
                                ? mediaUrl(activeStep.photo_url)
                                : undefined
                            }
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="h-full w-full object-cover"
                          />
                        ) : activeStep?.photo_url ? (
                          <img
                            src={mediaUrl(activeStep.photo_url)}
                            alt={activeStep.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <IsometricVenueArt
                            accent={venue.accent || '#0ea5e9'}
                            buildings={venue.buildings.length}
                            floors={Math.max(2, route.levels.length)}
                            compact
                          />
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-slate-950/60" />
                      </div>

                      {/* Top Bar inside Street View */}
                      <div className="relative z-10 flex items-center justify-between p-3.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-3 py-1 text-xs font-bold text-cyan-300 ring-1 ring-cyan-400/40">
                            <Eye className="h-3.5 w-3.5" />
                            STEP {activeStepIdx + 1} OF {route.steps.length}
                          </span>
                          <span className="rounded-full bg-slate-950/80 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-white/15">
                            {formatLevel(activeStep?.level ?? 0)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {activeStep?.photo_url && (
                            <button
                              type="button"
                              onClick={() => {
                                setLightboxZoom(1);
                                setLightboxUrl({
                                  url: mediaUrl(activeStep.photo_url)!,
                                  caption: `${activeStep.name} (${formatLevel(activeStep.level)})`,
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded-xl bg-slate-950/80 px-2.5 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 hover:bg-slate-900 transition"
                            >
                              <Maximize2 className="h-3.5 w-3.5 text-cyan-300" />
                              HD Zoom
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowStreetStage(false)}
                            className="rounded-xl bg-slate-950/80 px-2.5 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/15 hover:text-white transition"
                          >
                            Close ✕
                          </button>
                        </div>
                      </div>

                      {/* AR Turn Chevrons */}
                      <div className="pointer-events-none relative z-10 flex items-center justify-center mb-6">
                        {activeStep?.icon === 'arrive' ? (
                          <div className="flex flex-col items-center gap-1 rounded-2xl bg-emerald-500/30 px-5 py-2.5 ring-2 ring-emerald-400 shadow-lg">
                            <Flag className="h-7 w-7 text-emerald-300" />
                            <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-100">
                              Destination Reached
                            </span>
                          </div>
                        ) : activeStep?.icon === 'lift' ||
                          activeStep?.icon === 'up' ||
                          activeStep?.icon === 'down' ? (
                          <div className="flex items-center gap-2.5 rounded-2xl bg-amber-500/30 px-5 py-2.5 ring-2 ring-amber-400 shadow-lg">
                            {activeStep?.icon === 'down' ? (
                              <ArrowDown className="h-6 w-6 text-amber-300 animate-bounce" />
                            ) : (
                              <ArrowUp className="h-6 w-6 text-amber-300 animate-bounce" />
                            )}
                            <span className="text-xs font-extrabold uppercase tracking-wider text-amber-100">
                              {activeStep?.icon === 'lift'
                                ? `Take Lift · ${formatLevel(activeStep.level)}`
                                : `Take Stairs · ${formatLevel(activeStep.level)}`}
                            </span>
                          </div>
                        ) : (
                          <div
                            style={{
                              transform: `perspective(420px) rotateX(54deg) rotateZ(${
                                activeStep?.icon === 'left'
                                  ? '-38deg'
                                  : activeStep?.icon === 'right'
                                    ? '38deg'
                                    : '0deg'
                              })`,
                            }}
                            className="flex flex-col items-center -space-y-3"
                          >
                            <ChevronUp className="h-10 w-10 text-cyan-300 stroke-[3]" />
                            <ChevronUp className="h-11 w-11 text-cyan-300 stroke-[3]" />
                            <ChevronUp className="h-12 w-12 text-white stroke-[3.2]" />
                          </div>
                        )}
                      </div>

                      {/* Bottom Instruction & Navigation */}
                      <div className="relative z-10 m-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-950/85 p-3 text-white ring-1 ring-white/15">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold truncate">
                            {activeStep?.instruction}
                          </div>
                          <div className="text-xs text-cyan-300 truncate">
                            {activeStep?.name}
                            {activeStep && activeStep.distance_m > 0
                              ? ` · Walk ${Math.round(activeStep.distance_m)} m`
                              : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={activeStepIdx <= 0}
                            onClick={() => {
                              const prev = Math.max(0, activeStepIdx - 1);
                              handleStepClick(route.steps[prev], prev);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 transition"
                            aria-label="Previous step"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={activeStepIdx >= route.steps.length - 1}
                            onClick={() => {
                              const nxt = Math.min(
                                route.steps.length - 1,
                                activeStepIdx + 1,
                              );
                              handleStepClick(route.steps[nxt], nxt);
                            }}
                            className="inline-flex items-center gap-1 rounded-xl bg-cyan-500 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-cyan-400 disabled:opacity-30 transition"
                          >
                            Next
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : twinMode === '3d' ? (
                    /* 3D INTERACTIVE TWIN (Full Frame + Floating PiP Card) */
                    <div className="relative h-full w-full">
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
                            const idx = route.steps.findIndex(
                              (s) => s.node_id === n.id,
                            );
                            if (idx >= 0) handleStepClick(route.steps[idx], idx);
                          }}
                        />
                      </Suspense>

                      {/* Floating Step Picture-in-Picture Landmark Card */}
                      {activeStep && (
                        <div className="absolute bottom-3 left-3 z-10 w-[calc(100%-1.5rem)] sm:w-auto max-w-sm rounded-2xl bg-slate-950/90 p-2 text-white ring-1 ring-white/15 shadow-2xl flex items-center gap-2.5">
                          {activeStep.photo_url ? (
                            <img
                              src={mediaUrl(activeStep.photo_url)}
                              alt=""
                              onClick={() => {
                                setLightboxZoom(1);
                                setLightboxUrl({
                                  url: mediaUrl(activeStep.photo_url)!,
                                  caption: `${activeStep.name} (${formatLevel(activeStep.level)})`,
                                });
                              }}
                              className="h-12 w-14 rounded-xl object-cover ring-1 ring-white/20 shrink-0 cursor-pointer hover:opacity-90 transition"
                              title="Click for HD zoom"
                            />
                          ) : (
                            <div className="flex h-12 w-14 items-center justify-center rounded-xl bg-slate-800 text-sm text-cyan-400 shrink-0">
                              📍
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 text-[10px] font-bold text-cyan-300">
                              <span>
                                Step {activeStepIdx + 1}/{route.steps.length}
                              </span>
                              <span>·</span>
                              <span>{formatLevel(activeStep.level)}</span>
                            </div>
                            <div className="text-xs font-bold truncate">
                              {activeStep.instruction}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={activeStepIdx <= 0}
                              onClick={() => {
                                const prev = Math.max(0, activeStepIdx - 1);
                                handleStepClick(route.steps[prev], prev);
                              }}
                              className="rounded-lg p-1 text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-25"
                              title="Previous step"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={activeStepIdx >= route.steps.length - 1}
                              onClick={() => {
                                const nxt = Math.min(
                                  route.steps.length - 1,
                                  activeStepIdx + 1,
                                );
                                handleStepClick(route.steps[nxt], nxt);
                              }}
                              className="rounded-lg p-1 text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-25"
                              title="Next step"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowStreetStage(true)}
                              className="rounded-lg bg-cyan-500/20 px-2 py-1 text-[10px] font-extrabold text-cyan-300 ring-1 ring-cyan-400/40 hover:bg-cyan-500/30 transition ml-0.5"
                              title="Open full Cinema Street-View"
                            >
                              Photo ↗
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* 2D ARCHITECTURAL FLOOR PLAN (Full Frame + Floating PiP Card) */
                    <div className="relative h-full w-full">
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
                          const idx = route.steps.findIndex(
                            (s) => s.node_id === n.id,
                          );
                          if (idx >= 0) handleStepClick(route.steps[idx], idx);
                        }}
                      />

                      {/* Floating Step Picture-in-Picture Landmark Card */}
                      {activeStep && (
                        <div className="absolute bottom-3 left-3 z-10 w-[calc(100%-1.5rem)] sm:w-auto max-w-sm rounded-2xl bg-slate-950/90 p-2 text-white ring-1 ring-white/15 shadow-2xl flex items-center gap-2.5">
                          {activeStep.photo_url ? (
                            <img
                              src={mediaUrl(activeStep.photo_url)}
                              alt=""
                              onClick={() => {
                                setLightboxZoom(1);
                                setLightboxUrl({
                                  url: mediaUrl(activeStep.photo_url)!,
                                  caption: `${activeStep.name} (${formatLevel(activeStep.level)})`,
                                });
                              }}
                              className="h-12 w-14 rounded-xl object-cover ring-1 ring-white/20 shrink-0 cursor-pointer hover:opacity-90 transition"
                              title="Click for HD zoom"
                            />
                          ) : (
                            <div className="flex h-12 w-14 items-center justify-center rounded-xl bg-slate-800 text-sm text-cyan-400 shrink-0">
                              📍
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 text-[10px] font-bold text-cyan-300">
                              <span>
                                Step {activeStepIdx + 1}/{route.steps.length}
                              </span>
                              <span>·</span>
                              <span>{formatLevel(activeStep.level)}</span>
                            </div>
                            <div className="text-xs font-bold truncate">
                              {activeStep.instruction}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={activeStepIdx <= 0}
                              onClick={() => {
                                const prev = Math.max(0, activeStepIdx - 1);
                                handleStepClick(route.steps[prev], prev);
                              }}
                              className="rounded-lg p-1 text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-25"
                              title="Previous step"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={activeStepIdx >= route.steps.length - 1}
                              onClick={() => {
                                const nxt = Math.min(
                                  route.steps.length - 1,
                                  activeStepIdx + 1,
                                );
                                handleStepClick(route.steps[nxt], nxt);
                              }}
                              className="rounded-lg p-1 text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-25"
                              title="Next step"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowStreetStage(true)}
                              className="rounded-lg bg-cyan-500/20 px-2 py-1 text-[10px] font-extrabold text-cyan-300 ring-1 ring-cyan-400/40 hover:bg-cyan-500/30 transition ml-0.5"
                              title="Open full Cinema Street-View"
                            >
                              Photo ↗
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Leg-by-leg summary for multi-stop trips */}
                {route.legs && route.legs.length > 1 && (
                  <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/80 space-y-2">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                      Multi-Stop Leg Breakdown
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {route.legs.map((leg) => (
                        <div
                          key={leg.leg_index}
                          className="rounded-xl bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200/70 flex items-center justify-between gap-2"
                        >
                          <div className="truncate">
                            <span className="font-bold text-indigo-600 mr-1">
                              Leg {leg.leg_index}:
                            </span>
                            <span className="font-semibold text-slate-900">
                              {leg.from_name} → {leg.to_name}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] text-slate-500">
                            {Math.round(leg.distance_m)}m
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* LEFT ON DESKTOP / BOTTOM ON MOBILE: VISUAL TURN-BY-TURN STEPS */}
              <div
                className={`lg:col-span-5 lg:order-1 space-y-3 ${
                  mobileViewMode === 'street' || mobileViewMode === 'map'
                    ? 'hidden lg:block'
                    : ''
                }`}
              >
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
                          {voiceLang !== 'en-IN' && (
                            <p className="mt-1 text-xs font-semibold text-indigo-700 leading-snug">
                              {localizeInstruction(step, voiceLang)}
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-slate-500">{step.name}</p>

                          {/* Reference Photo Thumbnail */}
                          {step.photo_url && (
                            <div
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setLightboxZoom(1);
                                setLightboxUrl({
                                  url: mediaUrl(step.photo_url)!,
                                  caption: `${step.name} (${formatLevel(step.level)})`,
                                });
                              }}
                              className="mt-3 group relative flex items-center gap-3 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200/80 hover:ring-indigo-400 hover:bg-indigo-50/30 transition"
                            >
                              <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-900 ring-1 ring-slate-900/10">
                                <img
                                  src={mediaUrl(step.photo_url)}
                                  alt={step.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover hdr-photo transition-transform duration-300 group-hover:scale-110"
                                />
                                <span className="absolute right-1 bottom-1 rounded bg-slate-950/75 p-0.5 text-cyan-300 opacity-0 group-hover:opacity-100 transition">
                                  <ZoomIn className="h-3 w-3" />
                                </span>
                              </div>
                              <div className="min-w-0">
                                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Look for this landmark
                                </div>
                                <div className="text-xs text-slate-600 truncate">
                                  Tap for full HDR inspection
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
        </div>
      ) : null}

        {/* Mobile Sticky Thumb Navigation Dock */}
        {route && activeStep && (
          <aside
            aria-label="Mobile Navigation Controls"
            className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/15 bg-[#070B18]/95 px-4 pt-2.5 pb-3.5 backdrop-blur-xl text-white shadow-[0_-10px_35px_rgba(0,0,0,0.6)] safe-bottom"
          >
            <div className="mx-auto max-w-md space-y-2.5">
              {/* Active Step Mini Bar */}
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 text-cyan-300">
                  {renderStepIcon(activeStep.icon)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold text-white truncate">
                    {activeStep.instruction}
                  </div>
                  <div className="text-[11px] text-cyan-200/80 truncate">
                    {activeStep.name} · Step {activeStepIdx + 1} of {route.steps.length}
                    {activeStep.distance_m > 0 ? ` · ${Math.round(activeStep.distance_m)}m` : ''}
                  </div>
                </div>
              </div>

              {/* Big Thumb Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={activeStepIdx <= 0}
                  onClick={() => {
                    const prev = Math.max(0, activeStepIdx - 1);
                    handleStepClick(route.steps[prev], prev);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/10 py-3 text-xs font-bold text-white ring-1 ring-white/15 disabled:opacity-30 active:scale-95 transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </button>

                <button
                  type="button"
                  disabled={activeStepIdx >= route.steps.length - 1}
                  onClick={() => {
                    const nxt = Math.min(route.steps.length - 1, activeStepIdx + 1);
                    handleStepClick(route.steps[nxt], nxt);
                  }}
                  className="flex-[1.6] inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-600 py-3 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/30 active:scale-95 transition disabled:opacity-35"
                >
                  <span>Next Step</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Re-check My Location Modal */}
      <PhotoLocateModal
        open={recheckOpen}
        onClose={() => setRecheckOpen(false)}
        venue={venue}
        nodes={graph.nodes}
        priorNodeId={effectiveFromId || visitorLoc?.nodeId}
        queuedDestination={
          destNode ? { nodeId: destNode.id, name: destNode.name } : null
        }
        onConfirmedLocation={handleRecheckedLocation}
      />

      {/* Zoomable HDR Landmark Photo Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-lg"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl w-full overflow-hidden rounded-3xl bg-[#070B18] ring-1 ring-white/20 shadow-2xl"
          >
            <div className="relative max-h-[76vh] w-full overflow-auto bg-black flex items-center justify-center">
              <img
                src={mediaUrl(lightboxUrl.url)}
                alt={lightboxUrl.caption}
                style={{
                  transform: `scale(${lightboxZoom})`,
                  transformOrigin: 'center center',
                }}
                className="max-h-[74vh] w-full object-contain hdr-photo transition-transform duration-200"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-white border-t border-white/10">
              <span className="text-sm font-bold">{lightboxUrl.caption}</span>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-xl bg-white/10 p-0.5 text-xs font-bold">
                  {[1, 1.75, 2.5].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setLightboxZoom(z)}
                      className={`rounded-lg px-2.5 py-1 transition ${
                        lightboxZoom === z
                          ? 'bg-cyan-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setLightboxUrl(null)}
                  className="rounded-xl bg-white/10 p-2 hover:bg-white/20 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
