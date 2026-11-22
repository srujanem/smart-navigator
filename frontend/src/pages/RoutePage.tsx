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
  SlidersHorizontal,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  ZoomIn,
} from 'lucide-react';
import { FloorPlan2D } from '../components/FloorPlan2D';
import { GoogleStreetViewStage } from '../components/GoogleStreetViewStage';
import { IsometricVenueArt } from '../components/VenueCard';
import { PhotoLocateModal, type ConfirmedSpot } from '../components/PhotoLocateModal';
import { ErrorState, Skeleton3D } from '../components/ErrorState';
import { Canvas3DErrorBoundary } from '../components/ErrorBoundary';
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
  const [mobileViewMode, setMobileViewMode] = useState<'street' | 'guide' | 'map' | 'all'>('street');
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const touchStartXRef = React.useRef<number | null>(null);

  // Twin & Walker State (default 2D on mobile phones for instant load & clarity)
  const [twinMode, setTwinMode] = useState<'3d' | '2d'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? '2d' : '3d',
  );
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [isPlayingWalker, setIsPlayingWalker] = useState(true);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);

  // Voice Narration & Haptic Guidance State
  const [voiceLang, setVoiceLang] = useState<VoiceLang>('en-IN');
  const [speaking, setSpeaking] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [hapticPulseLabel, setHapticPulseLabel] = useState<string | null>(null);

  // Re-check Location Modal & Lightbox (Google Street View enabled by default)
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [showStreetStage, setShowStreetStage] = useState(true);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [lightboxUrl, setLightboxUrl] = useState<{
    url: string;
    caption: string;
  } | null>(null);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Set<string>>(() => new Set());
  const [storyModeOpen, setStoryModeOpen] = useState(false);
  const [helpCardOpen, setHelpCardOpen] = useState(false);
  const [torchActive, setTorchActive] = useState(false);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const torchStreamRef = React.useRef<MediaStream | null>(null);

  const markPhotoFailed = (rawUrl: string) => {
    setFailedPhotoUrls((prev) => {
      if (prev.has(rawUrl)) return prev;
      const next = new Set(prev);
      next.add(rawUrl);
      return next;
    });
  };

  useEffect(() => {
    const onOrient = (ev: DeviceOrientationEvent) => {
      const webkitH = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkitH === 'number' && Number.isFinite(webkitH)) {
        setCompassHeading(Math.round(webkitH));
      } else if (typeof ev.alpha === 'number' && Number.isFinite(ev.alpha)) {
        setCompassHeading(Math.round((360 - ev.alpha) % 360));
      }
    };
    window.addEventListener('deviceorientation', onOrient, true);
    return () => window.removeEventListener('deviceorientation', onOrient, true);
  }, []);

  const toggleNightTorch = async () => {
    if (torchActive) {
      torchStreamRef.current?.getTracks().forEach((t) => t.stop());
      torchStreamRef.current = null;
      setTorchActive(false);
      return;
    }
    setTorchActive(true);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        torchStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track && 'applyConstraints' in track) {
          await track.applyConstraints({
            advanced: [{ torch: true } as MediaTrackConstraintSet],
          });
        }
      }
    } catch {
      // Fallback: keep high-contrast screen torch glow active even on devices without hardware LED access
    }
  };

  useEffect(() => {
    return () => {
      torchStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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

  // Visual Landmark Facing Cues & "You Passed Too Far" Overshoot Checkpoints
  const stepWayfindingHints = useMemo(() => {
    const hints: Record<number, { facing?: string; overshoot?: string }> = {};
    if (!route || !graph || route.steps.length === 0) return hints;
    const pathSet = new Set(activePath);

    route.steps.forEach((st, idx) => {
      const currNode = nodeMap.get(st.node_id);
      if (!currNode) return;
      const sameFloorPlaces = graph.nodes.filter(
        (n) => n.is_place && n.level === currNode.level && n.id !== currNode.id,
      );

      if (idx === 0) {
        const nextStep = route.steps[1];
        const nextNode = nextStep ? nodeMap.get(nextStep.node_id) : null;
        const nearbyRef = sameFloorPlaces
          .filter((n) => n.id !== nextNode?.id)
          .sort(
            (a, b) =>
              Math.hypot(a.x - currNode.x, a.y - currNode.y) -
              Math.hypot(b.x - currNode.x, b.y - currNode.y),
          )[0];
        if (nextNode && nearbyRef) {
          hints[idx] = {
            facing: `🧭 Facing Check: Stand at ${currNode.name} facing towards ${nextNode.name} (keep ${nearbyRef.name} beside/behind you).`,
          };
        } else if (nextNode) {
          hints[idx] = {
            facing: `🧭 Facing Check: Face towards ${nextNode.name} before walking.`,
          };
        }
      }

      if (st.icon === 'left' || st.icon === 'right' || idx === route.steps.length - 1) {
        const offPathLandmark = sameFloorPlaces
          .filter((n) => !pathSet.has(n.id))
          .sort(
            (a, b) =>
              Math.hypot(a.x - currNode.x, a.y - currNode.y) -
              Math.hypot(b.x - currNode.x, b.y - currNode.y),
          )[0];
        if (offPathLandmark && Math.hypot(offPathLandmark.x - currNode.x, offPathLandmark.y - currNode.y) <= 22) {
          hints[idx] = {
            ...hints[idx],
            overshoot: `⚠️ Checkpoint: If you pass ${offPathLandmark.name}, you walked too far — turn back.`,
          };
        }
      }
    });
    return hints;
  }, [route, graph, activePath, nodeMap]);

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
        const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }) : null;
        if (nav && 'vibrate' in nav && (!nav.userActivation || nav.userActivation.hasBeenActive)) {
          nav.vibrate(pattern);
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

  const handleStepClick = useCallback(
    (step: Step, idx: number) => {
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
    },
    [route, twinMode],
  );

  // Windows Desktop Keyboard Shortcuts (← / → Step, Space = Play/Pause, V = Street View / 3D)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !route ||
        recheckOpen ||
        lightboxUrl ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nxt = Math.min(route.steps.length - 1, activeStepIdx + 1);
        if (route.steps[nxt]) handleStepClick(route.steps[nxt], nxt);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = Math.max(0, activeStepIdx - 1);
        if (route.steps[prev]) handleStepClick(route.steps[prev], prev);
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlayingWalker((p) => {
          if (!p) setScrubProgress(null);
          return !p;
        });
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setShowStreetStage((s) => !s);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [route, activeStepIdx, recheckOpen, lightboxUrl, handleStepClick]);

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
        <div className="max-w-3xl mx-auto pt-10">
          <div className="flex items-center gap-4 mb-4">
            {slug && (
              <Link
                to={`/v/${slug}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" /> Back to Venue
              </Link>
            )}
            <Link
              to="/venues"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              All Venues
            </Link>
          </div>
          <ErrorState
            message={routeError || 'Venue data unavailable.'}
            onRetry={() => void loadBase()}
          />
        </div>
      </div>
    );
  }

  const activeStep = route?.steps[activeStepIdx] ?? null;
  const activeStepNode = activeStep ? nodeMap.get(activeStep.node_id) : null;
  const totalWalkSteps = Math.max(0, Math.round(activeDistance / 0.72));

  const speakSingleStep = (step: Step) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(localizeInstruction(step, voiceLang));
    u.lang = voiceLang;
    u.rate = 0.96;
    window.speechSynthesis.speak(u);
  };

  const handleSwipeStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleSwipeEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || !route) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const delta = endX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(delta) < 55) return;
    if (delta < 0 && activeStepIdx < route.steps.length - 1) {
      const nxt = activeStepIdx + 1;
      handleStepClick(route.steps[nxt], nxt);
    } else if (delta > 0 && activeStepIdx > 0) {
      const prev = activeStepIdx - 1;
      handleStepClick(route.steps[prev], prev);
    }
  };

  return (
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-clip bg-slate-50 text-slate-900 flex flex-col">
      {/* =================================================================== */}
      {/* STICKY ROUTE COMMAND HEADER (Compact Mobile-First + Full Desktop)   */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#070B18] text-white">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 space-y-2.5">
          {/* Top Row: Back + Origin -> Destination + Compact Mobile Quick Buttons */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Link
                to={`/v/${slug}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-slate-200 ring-1 ring-white/10 hover:bg-white/15 transition"
                title="Back to Venue"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs sm:text-base font-display font-extrabold min-w-0">
                  {isEmergency && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white">
                      <Siren className="h-3 w-3" /> SOS
                    </span>
                  )}
                  <span className="text-cyan-300 truncate">
                    {originNode?.name || 'Start'}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="text-white truncate">
                    {destNode?.name || 'Destination'}
                  </span>
                </div>

                {route && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] sm:text-xs text-slate-300">
                    <span className="font-bold text-emerald-300">
                      {formatEta(activeEta)}
                    </span>
                    <span>·</span>
                    <span>{Math.round(activeDistance)} m</span>
                    {totalWalkSteps > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-cyan-200 font-semibold">
                          ~{totalWalkSteps} steps
                        </span>
                      </>
                    )}
                    <span className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">
                      Floors: {route.levels.map((l) => formatLevel(l)).join(' → ')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile Quick Actions (Voice + Collapsible Tools Drawer) */}
            <div className="flex lg:hidden items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handlePlayNarration}
                disabled={!route}
                className={`inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-bold transition ${
                  speaking
                    ? 'bg-rose-600 text-white'
                    : 'bg-indigo-600 text-white'
                }`}
                aria-label="Toggle voice narration"
              >
                {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                <span>{speaking ? 'Stop' : 'Voice'}</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileToolsOpen((v) => !v)}
                className={`inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-bold ring-1 transition ${
                  mobileToolsOpen
                    ? 'bg-cyan-400 text-slate-950 ring-cyan-300'
                    : 'bg-white/10 text-slate-200 ring-white/15'
                }`}
                aria-label="More route tools"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Tools</span>
              </button>
            </div>

            {/* Desktop Controls: Emergency Exit + Re-check + Story + Help + Haptics + Share + Voice */}
            <div className="hidden lg:flex flex-wrap items-center gap-2 shrink-0">
              {!isEmergency && (
                <button
                  type="button"
                  onClick={() => void handleEmergencyFromHere()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white shadow-md shadow-rose-600/35 ring-1 ring-rose-400/50 hover:bg-rose-500 transition"
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
                Re-check spot
              </button>

              <button
                type="button"
                onClick={() => setStoryModeOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 px-3 py-2 text-xs font-extrabold text-emerald-200 ring-1 ring-emerald-400/40 hover:bg-emerald-500 hover:text-slate-950 transition"
              >
                📱 Story Mode
              </button>

              <button
                type="button"
                onClick={() => setHelpCardOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500/20 px-3 py-2 text-xs font-bold text-indigo-200 ring-1 ring-indigo-400/35 hover:bg-indigo-500 hover:text-white transition"
              >
                🙋 Ask Passerby
              </button>

              <button
                type="button"
                onClick={() => setHapticsEnabled((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold ring-1 transition ${
                  hapticsEnabled
                    ? 'bg-amber-500/15 text-amber-200 ring-amber-400/35 hover:bg-amber-500/25'
                    : 'bg-white/[0.06] text-slate-400 ring-white/10 hover:text-white'
                }`}
              >
                {hapticsEnabled ? '📳 Haptics' : '📴 Haptics'}
              </button>

              <button
                type="button"
                onClick={() => void handleShareRoute(false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-2.5 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/15 transition"
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
                className="inline-flex items-center gap-1 rounded-xl bg-emerald-600/90 px-2.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition"
              >
                WhatsApp
              </button>

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

          {/* Collapsible Mobile Tools & Accessibility Drawer (hidden on desktop, expands cleanly on tap) */}
          <div className={`${mobileToolsOpen ? 'block' : 'hidden'} lg:block space-y-2.5 pt-2 border-t border-white/10`}>
            {/* Mobile-only Quick Utility Grid */}
            <div className="grid grid-cols-2 gap-1.5 lg:hidden">
              {!isEmergency && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileToolsOpen(false);
                    void handleEmergencyFromHere();
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-2.5 py-2 text-xs font-extrabold text-white"
                >
                  <Siren className="h-3.5 w-3.5" />
                  Emergency Exit
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileToolsOpen(false);
                  setRecheckOpen(true);
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500/20 px-2.5 py-2 text-xs font-bold text-cyan-200 ring-1 ring-cyan-400/35"
              >
                <Camera className="h-3.5 w-3.5" />
                Re-check Spot
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileToolsOpen(false);
                  setHelpCardOpen(true);
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-500/20 px-2.5 py-2 text-xs font-bold text-indigo-200 ring-1 ring-indigo-400/35"
              >
                🙋 Ask Passerby
              </button>
              <button
                type="button"
                onClick={() => void handleShareRoute(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600/90 px-2.5 py-2 text-xs font-bold text-white"
              >
                <Share2 className="h-3.5 w-3.5" />
                WhatsApp Share
              </button>
              <button
                type="button"
                onClick={() => setHapticsEnabled((v) => !v)}
                className={`flex items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold ring-1 ${
                  hapticsEnabled
                    ? 'bg-amber-500/20 text-amber-200 ring-amber-400/35'
                    : 'bg-white/10 text-slate-300 ring-white/15'
                }`}
              >
                {hapticsEnabled ? '📳 Haptics ON' : '📴 Haptics OFF'}
              </button>
              <div className="flex items-center rounded-xl bg-white/10 px-2 py-1 ring-1 ring-white/15">
                <Languages className="h-3.5 w-3.5 text-cyan-300 mr-1.5 shrink-0" />
                <select
                  value={voiceLang}
                  onChange={(e) => setVoiceLang(e.target.value as VoiceLang)}
                  className="w-full bg-transparent text-xs font-bold text-white focus:outline-none"
                  aria-label="Voice language"
                >
                  {VOICE_LANGUAGES.map((vl) => (
                    <option key={vl.code} value={vl.code} className="text-slate-900">
                      {vl.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {hapticsEnabled && hapticPulseLabel && (
              <div className="hidden lg:flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-400/25">
                <span>{hapticPulseLabel}</span>
                <span className="text-[10px] text-amber-300/80">
                  Eyes-Free Tactile Guidance · 1 Pulse=Left · 2=Right · 3=Lift/Stairs
                </span>
              </div>
            )}

            {/* Mobility Profiles + Avoid Crowds + Alternative Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full py-0.5">
                <div className="flex shrink-0 items-center gap-1 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
                  <button
                    type="button"
                    onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'walk')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                      profileParam === 'walk'
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Footprints className="h-3.5 w-3.5 text-cyan-500" />
                    Walk
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'wheelchair')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                      profileParam === 'wheelchair'
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Accessibility className="h-3.5 w-3.5" />
                    Wheelchair
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRouteParams(effectiveFromId, effectiveToId, 'stretcher')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                      profileParam === 'stretcher'
                        ? 'bg-amber-400 text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Bed className="h-3.5 w-3.5" />
                    Stretcher
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    updateRouteParams(effectiveFromId, effectiveToId, profileParam, {
                      avoidCrowds: !avoidCrowdsParam,
                    })
                  }
                  className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold ring-1 whitespace-nowrap transition ${
                    avoidCrowdsParam
                      ? 'bg-violet-500/25 text-violet-200 ring-violet-400/50'
                      : 'bg-white/[0.05] text-slate-300 ring-white/10 hover:text-white'
                  }`}
                >
                  <Users className="h-3.5 w-3.5 text-violet-400" />
                  {avoidCrowdsParam ? 'Quiet ✓' : 'Avoid Crowds'}
                </button>
              </div>

              {route && route.alternatives.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full">
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

        {(route?.orientation_hint || stepWayfindingHints[0]?.facing) && (
          <div
            className={`${
              mobileViewMode === 'street' || activeStepIdx > 0
                ? 'hidden sm:flex'
                : 'flex'
            } flex-wrap items-center justify-between gap-3 rounded-2xl bg-indigo-50 px-4 py-2.5 text-xs text-indigo-950 ring-1 ring-indigo-200`}
          >
            <div className="flex items-center gap-2.5">
              <Compass className="h-4 w-4 text-indigo-600 shrink-0" />
              <div>
                <span className="font-bold">Which Way Am I Facing? </span>
                {route?.orientation_hint || stepWayfindingHints[0]?.facing}
              </div>
            </div>
            {compassHeading !== null && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-extrabold text-white">
                🧭 Live Compass: {compassHeading}°
              </span>
            )}
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

        {/* MULTI-STOP VISIT CHECKLIST BAR (Hidden on mobile until multi-stop or Tools opened) */}
        {route && (
          <div
            className={`${
              multiStops.length > 2 || mobileToolsOpen ? 'flex' : 'hidden lg:flex'
            } rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/80 shadow-soft flex-wrap items-center justify-between gap-2.5`}
          >
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
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-32 lg:pb-8 min-w-0">
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
            {/* Mobile-First 3-Tab Native Navigation Switcher (Google Street View Default) */}
            <div className="lg:hidden grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200/90 shadow-soft mb-3">
              <button
                type="button"
                onClick={() => {
                  setMobileViewMode('street');
                  setShowStreetStage(true);
                }}
                className={`py-2.5 text-xs font-extrabold rounded-xl transition ${
                  mobileViewMode === 'street'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🚶 Street View
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('guide')}
                className={`py-2.5 text-xs font-extrabold rounded-xl transition ${
                  mobileViewMode === 'guide'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🧭 Easy Guide
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileViewMode('map');
                  setShowStreetStage(false);
                }}
                className={`py-2.5 text-xs font-extrabold rounded-xl transition ${
                  mobileViewMode === 'map'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🗺️ {twinMode === '3d' ? '3D' : '2D'} Map
              </button>
            </div>

            {/* MOBILE-FIRST ACTIVE STEP HERO GUIDANCE CARD (Big Direction + Un-Cropped Landmark Photo + Swipe) */}
            {activeStep && mobileViewMode === 'guide' && (
              <div
                onTouchStart={handleSwipeStart}
                onTouchEnd={handleSwipeEnd}
                className="lg:hidden mb-3 overflow-hidden rounded-3xl bg-gradient-to-br from-[#0A1128] via-slate-900 to-indigo-950 text-white ring-1 ring-cyan-400/35 shadow-xl"
              >
                {/* Top Step Action Banner */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-400/20 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/40">
                      Step {activeStepIdx + 1} of {route.steps.length} · {formatLevel(activeStep.level)}
                    </span>
                    {activeStep.distance_m > 0 && (
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                        {Math.round(activeStep.distance_m)} m · ~{activeStep.steps_count || Math.max(2, Math.round(activeStep.distance_m / 0.72))} steps
                      </span>
                    )}
                  </div>

                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-2 ${
                        activeStepIdx === route.steps.length - 1 || activeStep.icon === 'arrive'
                          ? 'bg-emerald-500/25 ring-emerald-400 text-emerald-300'
                          : 'bg-cyan-500/20 ring-cyan-400/70 text-cyan-200'
                      }`}
                    >
                      {renderStepIcon(activeStep.icon)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300">
                        {activeStep.short_action ||
                          (activeStep.icon === 'left'
                            ? 'Turn Left'
                            : activeStep.icon === 'right'
                              ? 'Turn Right'
                              : activeStep.icon === 'arrive'
                                ? 'Destination Reached'
                                : 'Walk Straight')}
                      </div>
                      <h2 className="mt-0.5 font-display text-base font-extrabold leading-snug text-white">
                        {activeStep.instruction}
                      </h2>
                      {voiceLang !== 'en-IN' && (
                        <p className="mt-1 text-xs font-semibold text-cyan-200 leading-snug">
                          {localizeInstruction(activeStep, voiceLang)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Door Side + Passing Landmarks Badges */}
                  {(activeStep.door_side || (activeStep.passing_landmarks && activeStep.passing_landmarks.length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {activeStep.door_side && activeStep.door_side !== 'ahead' && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-extrabold text-emerald-200 ring-1 ring-emerald-400/40">
                          🚪 Door is on your {activeStep.door_side.toUpperCase()}
                        </span>
                      )}
                      {activeStep.passing_landmarks?.slice(0, 2).map((lm, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 ring-1 ring-white/15"
                        >
                          👀 Pass {lm}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Un-Cropped Landmark Photo Preview (shows full vertical phone photo as-is!) */}
                {activeStep.photo_url && !failedPhotoUrls.has(activeStep.photo_url) && (
                  <div
                    onClick={() => {
                      setLightboxZoom(1);
                      setLightboxUrl({
                        url: mediaUrl(activeStep.photo_url)!,
                        caption: `${activeStep.name} (${formatLevel(activeStep.level)})`,
                      });
                    }}
                    className="relative h-56 w-full bg-slate-950 border-t border-white/10 overflow-hidden cursor-pointer"
                  >
                    <img
                      src={mediaUrl(activeStep.photo_url)}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 h-full w-full object-cover blur-2xl scale-110 opacity-35"
                    />
                    <img
                      src={mediaUrl(activeStep.photo_url)}
                      alt={activeStep.name}
                      onError={() => markPhotoFailed(activeStep.photo_url!)}
                      className="relative z-10 h-full w-full object-contain"
                    />
                    <span className="absolute left-2.5 top-2.5 z-20 rounded-lg bg-slate-950/80 px-2.5 py-1 text-[10px] font-extrabold text-cyan-300 ring-1 ring-cyan-400/40 backdrop-blur-md">
                      👀 Look for: {activeStep.name}
                    </span>
                    <span className="absolute right-2.5 bottom-2.5 z-20 inline-flex items-center gap-1 rounded-lg bg-slate-950/85 px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/20">
                      <Maximize2 className="h-3 w-3 text-cyan-300" />
                      Tap to Zoom
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between bg-slate-950/80 px-4 py-2 text-[11px] text-slate-400 border-t border-white/10">
                  <span>👆 Swipe left/right for steps</span>
                  <button
                    type="button"
                    onClick={() => setRecheckOpen(true)}
                    className="font-bold text-cyan-300 hover:text-cyan-200"
                  >
                    📷 Lost? Snap Photo
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start min-w-0">
              {/* RIGHT ON DESKTOP / MAP TAB ON MOBILE: HERO 3D/2D TWIN & STREET-VIEW WORKSPACE */}
              <div
                className={`lg:col-span-7 lg:order-2 lg:sticky lg:top-24 space-y-3 min-w-0 ${
                  mobileViewMode === 'guide' ? 'hidden lg:block' : ''
                }`}
              >
                {/* Unified Workspace Header Ribbon (Desktop Only — Mobile uses the single 3-Tab Switcher above) */}
                <div className="hidden lg:flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-2 ring-1 ring-slate-200/80 shadow-soft">
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

                {/* Mobile 2D / 3D Sub-Switcher (Only shown when Map tab is active on phones) */}
                {mobileViewMode === 'map' && !showStreetStage && (
                  <div className="lg:hidden flex items-center justify-between rounded-xl bg-white px-3 py-1.5 ring-1 ring-slate-200/80">
                    <span className="text-[11px] font-bold text-slate-600">
                      Floor Blueprint & 3D Twin
                    </span>
                    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setTwinMode('2d');
                          if (selectedLevel === 'all') {
                            setSelectedLevel(activeStep?.level ?? route.levels[0] ?? 0);
                          }
                        }}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-extrabold transition ${
                          twinMode === '2d'
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        2D Map
                      </button>
                      <button
                        type="button"
                        onClick={() => setTwinMode('3d')}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-extrabold transition ${
                          twinMode === '3d'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        3D Twin
                      </button>
                    </div>
                  </div>
                )}

                {/* FULL-BLEED WORKSPACE STAGE (Sized so Mobile Header + Tabs + Stage + Bottom Thumb Dock fit in 1 screen) */}
                <div className="relative h-[calc(100dvh-13.75rem)] min-h-[370px] max-h-[520px] sm:h-[540px] lg:h-[calc(100dvh-14.5rem)] lg:max-h-[680px] w-full overflow-hidden rounded-3xl bg-[#060A16] ring-1 ring-slate-900/15 shadow-2xl">
                  {showStreetStage ? (
                    <GoogleStreetViewStage
                      venue={venue}
                      graph={graph}
                      route={route}
                      activeStepIdx={activeStepIdx}
                      onSelectStep={(st, idx) => handleStepClick(st, idx)}
                      onClose={() => {
                        setShowStreetStage(false);
                        if (mobileViewMode === 'street') {
                          setMobileViewMode('map');
                        }
                      }}
                      onSpeakStep={(st) => speakSingleStep(st)}
                      onShareRoute={() => {
                        try {
                          void navigator.clipboard.writeText(window.location.href);
                          setCopiedRouteLink(true);
                          window.setTimeout(() => setCopiedRouteLink(false), 2400);
                        } catch {
                          // Ignore clipboard errors
                        }
                      }}
                      onOpenLightbox={(url, caption) => {
                        setLightboxZoom(1);
                        setLightboxUrl({ url, caption });
                      }}
                      onChangeDestination={(nextToId) => {
                        updateRouteParams(effectiveFromId, nextToId, profileParam);
                      }}
                    />
                  ) : twinMode === '3d' ? (
                    /* 3D INTERACTIVE TWIN (Full Frame + Floating PiP Card) */
                    <div className="relative h-full w-full">
                      <Canvas3DErrorBoundary
                        fallbackTitle="3D Twin Paused"
                        onFallbackTo2D={() => {
                          setTwinMode('2d');
                          if (selectedLevel === 'all') {
                            setSelectedLevel(activeStep?.level ?? 0);
                          }
                        }}
                      >
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
                      </Canvas3DErrorBoundary>

                      {/* Floating Step Picture-in-Picture Landmark Card */}
                      {activeStep && (
                        <div className="absolute bottom-3 left-3 z-10 w-[calc(100%-1.5rem)] sm:w-auto max-w-sm rounded-2xl bg-slate-950/90 p-2 text-white ring-1 ring-white/15 shadow-2xl flex items-center gap-2.5">
                          {activeStep.photo_url && !failedPhotoUrls.has(activeStep.photo_url) ? (
                            <img
                              src={mediaUrl(activeStep.photo_url)}
                              alt=""
                              onError={() => markPhotoFailed(activeStep.photo_url!)}
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
                        headingDeg={compassHeading}
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
                          {activeStep.photo_url && !failedPhotoUrls.has(activeStep.photo_url) ? (
                            <img
                              src={mediaUrl(activeStep.photo_url)}
                              alt=""
                              onError={() => markPhotoFailed(activeStep.photo_url!)}
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
                className={`lg:col-span-5 lg:order-1 space-y-3 min-w-0 ${
                  mobileViewMode === 'map'
                    ? 'hidden lg:block'
                    : ''
                }`}
              >
              <div className="flex items-center justify-between px-1">
                <h2 className="font-display text-base font-extrabold text-slate-900">
                  Visual Turn-by-Turn Steps ({route.steps.length})
                </h2>
                <span className="text-xs text-slate-500">
                  <span className="hidden lg:inline">⌨️ ←/→ Step · Space Play · </span>
                  Tap step to inspect
                </span>
              </div>

              {/* Interactive Multi-Floor Journey Elevation & Progress Map */}
              {route.steps.length >= 2 && (() => {
                const lvls = route.steps.map((s) => s.level);
                const minL = Math.min(...lvls);
                const maxL = Math.max(...lvls);
                const spanL = Math.max(1, maxL - minL);
                const padX = 16;
                const w = 320;
                const h = 58;
                const pts = route.steps.map((st, idx) => {
                  const x = padX + (idx / Math.max(1, route.steps.length - 1)) * (w - padX * 2);
                  const y =
                    maxL === minL
                      ? h / 2
                      : h - 14 - ((st.level - minL) / spanL) * (h - 28);
                  return { x, y, step: st, idx };
                });
                const fullPath = pts
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                  .join(' ');
                const donePath = pts
                  .slice(0, activeStepIdx + 1)
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                  .join(' ');
                const pct = Math.round(
                  ((activeStepIdx + 1) / Math.max(1, route.steps.length)) * 100,
                );
                return (
                  <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/80 shadow-soft space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-extrabold uppercase tracking-wider text-slate-600">
                        Journey Elevation · {route.levels.length} Floor
                        {route.levels.length > 1 ? 's' : ''}
                      </span>
                      <span className="font-mono font-bold text-indigo-600">
                        {pct}% · Step {activeStepIdx + 1}/{route.steps.length}
                      </span>
                    </div>
                    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full overflow-hidden">
                      <defs>
                        <linearGradient id="journeyProgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#06b6d4" />
                          <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                      </defs>
                      <path
                        d={fullPath}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d={donePath}
                        fill="none"
                        stroke="url(#journeyProgGrad)"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {pts.map((p) => {
                        const isCur = p.idx === activeStepIdx;
                        const isPassed = p.idx <= activeStepIdx;
                        const isEnd = p.idx === pts.length - 1;
                        return (
                          <g
                            key={p.idx}
                            transform={`translate(${p.x}, ${p.y})`}
                            onClick={() => handleStepClick(p.step, p.idx)}
                            style={{ cursor: 'pointer' }}
                          >
                            {isCur && (
                              <circle r="10" fill="#06b6d4" opacity="0.22" className="radar-ping-svg" />
                            )}
                            <circle
                              r={isCur ? 5.5 : isEnd ? 5 : 3.5}
                              fill={
                                isEnd
                                  ? '#10b981'
                                  : isCur
                                    ? '#0284c7'
                                    : isPassed
                                      ? '#06b6d4'
                                      : '#cbd5e1'
                              }
                              stroke="#ffffff"
                              strokeWidth="1.8"
                            />
                            {(p.idx === 0 || isCur || isEnd) && (
                              <text
                                y={p.y < 22 ? 15 : -9}
                                textAnchor="middle"
                                fontSize="8.5"
                                fontWeight="800"
                                fill={isCur ? '#0284c7' : '#64748b'}
                              >
                                {p.step.level === 0 ? 'G' : `F${p.step.level}`}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                );
              })()}

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

              {activeStepIdx === route.steps.length - 1 && activeStep && (
                <div className="arrival-pop relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-4 text-white shadow-lg ring-1 ring-emerald-300/50">
                  <div className="flex items-center gap-3.5">
                    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30">
                      <svg viewBox="0 0 48 48" className="h-9 w-9">
                        <circle
                          cx="24"
                          cy="24"
                          r="19"
                          fill="none"
                          stroke="#a7f3d0"
                          strokeWidth="3"
                          className="arrival-ring-draw"
                        />
                        <path
                          d="M15 24.5 L21.5 31 L34 18"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-100">
                        ✨ Destination Reached
                      </div>
                      <div className="font-display text-base font-extrabold truncate">
                        Welcome to {activeStep.name}!
                      </div>
                      <div className="text-xs text-emerald-50/90">
                        {formatLevel(activeStep.level)} · {Math.round(route.distance_m)}m walked
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2.5 lg:max-h-[calc(100dvh-14.5rem)] lg:overflow-y-auto lg:pr-1.5 thin-scrollbar smooth-scroll">
                {route.steps.map((step, idx) => {
                  const isActive = idx === activeStepIdx;
                  const isLast = idx === route.steps.length - 1;
                  const prevStep = idx > 0 ? route.steps[idx - 1] : null;
                  const isFloorChange =
                    (prevStep && prevStep.level !== step.level) ||
                    step.icon === 'lift' ||
                    step.icon === 'up' ||
                    step.icon === 'down';
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
                      {isFloorChange && (
                        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-1.5 text-[11px] font-extrabold text-amber-900 ring-1 ring-amber-200/90">
                          <span className="inline-flex items-center gap-1.5">
                            <span>{step.icon === 'lift' ? '🛗' : '🪜'}</span>
                            <span>
                              Floor Change:{' '}
                              {prevStep && prevStep.level !== step.level
                                ? `${formatLevel(prevStep.level)} → ${formatLevel(step.level)}`
                                : formatLevel(step.level)}
                            </span>
                          </span>
                          <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-800">
                            {step.icon === 'lift' ? 'Elevator' : 'Stairs'}
                          </span>
                        </div>
                      )}
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
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shrink-0">
                                {Math.round(step.distance_m)} m · ~{step.steps_count || Math.max(2, Math.round(step.distance_m / 0.72))} steps
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
                          {(step.door_side || (step.passing_landmarks && step.passing_landmarks.length > 0)) && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {step.door_side && step.door_side !== 'ahead' && (
                                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 ring-1 ring-emerald-200">
                                  🚪 Door on your {step.door_side}
                                </span>
                              )}
                              {step.passing_landmarks?.slice(0, 2).map((lm, i) => (
                                <span
                                  key={i}
                                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                                >
                                  👀 Pass {lm}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="mt-0.5 text-xs text-slate-500">{step.name}</p>

                          {stepWayfindingHints[idx]?.facing && (
                            <div className="mt-2 rounded-xl bg-cyan-50 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-900 ring-1 ring-cyan-200">
                              {stepWayfindingHints[idx].facing}
                            </div>
                          )}

                          {stepWayfindingHints[idx]?.overshoot && (
                            <div className="mt-2 rounded-xl bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                              {stepWayfindingHints[idx].overshoot}
                            </div>
                          )}

                          {/* Reference Photo Thumbnail */}
                          {step.photo_url && !failedPhotoUrls.has(step.photo_url) && (
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
                                  onError={() => markPhotoFailed(step.photo_url!)}
                                  className="h-full w-full object-contain bg-slate-950 hdr-photo transition-transform duration-300 group-hover:scale-105"
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
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-white/10 py-3 text-xs font-bold text-white ring-1 ring-white/15 disabled:opacity-30 active:scale-95 transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </button>

                <button
                  type="button"
                  onClick={() => speakSingleStep(activeStep)}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3.5 py-3 text-xs font-extrabold text-white active:scale-95 transition"
                  aria-label="Speak current step"
                  title="Speak current step"
                >
                  <Volume2 className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  disabled={activeStepIdx >= route.steps.length - 1}
                  onClick={() => {
                    const nxt = Math.min(route.steps.length - 1, activeStepIdx + 1);
                    handleStepClick(route.steps[nxt], nxt);
                  }}
                  className="flex-[1.6] inline-flex items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 py-3 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/30 active:scale-95 transition disabled:opacity-35"
                >
                  <span>
                    {activeStepIdx >= route.steps.length - 1 ? 'Arrived ✓' : 'Next Step'}
                  </span>
                  {activeStepIdx < route.steps.length - 1 && (
                    <ChevronRight className="h-4 w-4" />
                  )}
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

      {/* FULL-SCREEN SIMPLE PHOTO STORY WALKING MODE */}
      {storyModeOpen && route && activeStep && (
        <div
          className={`fixed inset-0 z-50 flex flex-col justify-between bg-[#050914] text-white p-4 sm:p-6 ${
            torchActive ? 'ring-8 ring-inset ring-amber-300' : ''
          }`}
        >
          {/* Top Story Progress Bar & Controls */}
          <div className="mx-auto w-full max-w-lg space-y-3 z-10">
            <div className="flex gap-1.5">
              {route.steps.map((st, i) => (
                <button
                  key={st.index}
                  type="button"
                  onClick={() => handleStepClick(st, i)}
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    i <= activeStepIdx ? 'bg-cyan-400' : 'bg-white/20'
                  }`}
                  aria-label={`Jump to step ${i + 1}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-cyan-500 px-3 py-1 text-xs font-extrabold text-slate-950">
                  STEP {activeStepIdx + 1} / {route.steps.length}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-cyan-200">
                  {formatLevel(activeStep.level)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void toggleNightTorch()}
                  className={`rounded-xl px-2.5 py-1.5 text-xs font-extrabold ring-1 transition ${
                    torchActive
                      ? 'bg-amber-400 text-slate-950 ring-amber-200'
                      : 'bg-white/10 text-slate-200 ring-white/15'
                  }`}
                >
                  🔦 {torchActive ? 'Torch ON' : 'Torch'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStoryModeOpen(false);
                    setHelpCardOpen(true);
                  }}
                  className="rounded-xl bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white"
                >
                  🙋 Help Card
                </button>
                <button
                  type="button"
                  onClick={() => setStoryModeOpen(false)}
                  className="rounded-xl bg-white/10 p-1.5 text-slate-300 hover:text-white"
                  aria-label="Close Story Mode"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Center Giant Photo + Big Turn Banner (Swipeable + Un-Cropped) */}
          <div
            onTouchStart={handleSwipeStart}
            onTouchEnd={handleSwipeEnd}
            className="mx-auto my-3 w-full max-w-lg flex-1 overflow-hidden rounded-3xl bg-slate-950 ring-1 ring-white/15 relative flex flex-col justify-between"
          >
            <div className="absolute inset-0">
              {activeStep.photo_url && !failedPhotoUrls.has(activeStep.photo_url) ? (
                <>
                  <img
                    src={mediaUrl(activeStep.photo_url)}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover blur-2xl scale-110 opacity-40"
                  />
                  <img
                    src={mediaUrl(activeStep.photo_url)}
                    alt={activeStep.name}
                    onError={() => markPhotoFailed(activeStep.photo_url!)}
                    className="relative z-[1] h-full w-full object-contain"
                  />
                </>
              ) : (
                <IsometricVenueArt
                  accent={venue.accent || '#0ea5e9'}
                  buildings={venue.buildings.length}
                  floors={Math.max(2, route.levels.length)}
                  compact
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-slate-950/70" />
            </div>

            {/* Huge Direction Pill */}
            <div className="relative z-10 p-4 flex justify-center">
              <div className="inline-flex items-center gap-2.5 rounded-2xl bg-slate-950/90 px-5 py-3 text-base sm:text-lg font-extrabold text-cyan-300 ring-2 ring-cyan-400 shadow-2xl">
                {renderStepIcon(activeStep.icon)}
                <span>
                  {activeStep.icon === 'left'
                    ? '⬅️ TURN LEFT'
                    : activeStep.icon === 'right'
                      ? '➡️ TURN RIGHT'
                      : activeStep.icon === 'up'
                        ? '⬆️ GO UP STAIRS'
                        : activeStep.icon === 'down'
                          ? '⬇️ GO DOWN STAIRS'
                          : activeStep.icon === 'lift'
                            ? '🛗 TAKE LIFT'
                            : activeStep.icon === 'arrive'
                              ? '🏁 YOU ARRIVED!'
                              : '⬆️ WALK STRAIGHT'}
                  {activeStep.distance_m > 0 ? ` · ${Math.round(activeStep.distance_m)}m` : ''}
                </span>
              </div>
            </div>

            {/* Center 3D Perspective AR Floor Chevrons / Arrival Ring inside Photo Story */}
            <div className="pointer-events-none relative z-10 flex items-center justify-center my-auto">
              {activeStep.icon === 'arrive' || activeStepIdx === route.steps.length - 1 ? (
                <div className="arrival-pop flex flex-col items-center gap-1.5 rounded-3xl bg-emerald-950/85 px-6 py-4 ring-2 ring-emerald-400 shadow-2xl backdrop-blur-md">
                  <svg viewBox="0 0 60 60" className="h-12 w-12">
                    <circle
                      cx="30"
                      cy="30"
                      r="24"
                      fill="rgba(16,185,129,0.2)"
                      stroke="#34d399"
                      strokeWidth="3.5"
                      className="arrival-ring-draw"
                    />
                    <path
                      d="M19 31 L27 39 L42 22"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-200">
                    ✨ Destination Reached
                  </span>
                </div>
              ) : activeStep.icon !== 'lift' && activeStep.icon !== 'up' && activeStep.icon !== 'down' ? (
                <div
                  style={{
                    transform: `perspective(420px) rotateX(56deg) rotateZ(${
                      activeStep.icon === 'left'
                        ? '-40deg'
                        : activeStep.icon === 'right'
                          ? '40deg'
                          : '0deg'
                    })`,
                  }}
                  className="flex flex-col items-center -space-y-4 drop-shadow-[0_0_16px_rgba(34,211,238,0.9)]"
                >
                  <ChevronUp className="h-12 w-12 text-cyan-300 stroke-[3.2] street-chevron-3" />
                  <ChevronUp className="h-14 w-14 text-cyan-200 stroke-[3.2] street-chevron-2" />
                  <ChevronUp className="h-16 w-16 text-white stroke-[3.4] street-chevron-1" />
                </div>
              ) : null}
            </div>

            {/* Bottom Step Instruction & Checkpoint Warnings */}
            <div className="relative z-10 p-5 space-y-2.5 bg-slate-950/85 backdrop-blur-md border-t border-white/10">
              <div className="text-lg sm:text-xl font-display font-extrabold leading-snug text-white">
                {activeStep.instruction}
              </div>
              {voiceLang !== 'en-IN' && (
                <div className="text-sm font-bold text-cyan-300">
                  {localizeInstruction(activeStep, voiceLang)}
                </div>
              )}
              {stepWayfindingHints[activeStepIdx]?.facing && (
                <div className="rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-bold text-cyan-200 ring-1 ring-cyan-400/40">
                  {stepWayfindingHints[activeStepIdx].facing}
                </div>
              )}
              {stepWayfindingHints[activeStepIdx]?.overshoot && (
                <div className="rounded-xl bg-amber-500/20 px-3 py-2 text-xs font-bold text-amber-200 ring-1 ring-amber-400/40">
                  {stepWayfindingHints[activeStepIdx].overshoot}
                </div>
              )}
            </div>
          </div>

          {/* Giant Thumb Navigation Bar */}
          <div className="mx-auto w-full max-w-lg flex items-center gap-2.5 z-10">
            <button
              type="button"
              disabled={activeStepIdx <= 0}
              onClick={() =>
                handleStepClick(route.steps[Math.max(0, activeStepIdx - 1)], Math.max(0, activeStepIdx - 1))
              }
              className="flex-1 rounded-2xl bg-white/10 py-4 text-sm font-extrabold text-white ring-1 ring-white/15 disabled:opacity-30"
            >
              ⬅️ Prev
            </button>
            <button
              type="button"
              onClick={() => {
                if ('speechSynthesis' in window) {
                  window.speechSynthesis.cancel();
                  const u = new SpeechSynthesisUtterance(localizeInstruction(activeStep, voiceLang));
                  u.lang = voiceLang;
                  window.speechSynthesis.speak(u);
                }
              }}
              className="rounded-2xl bg-indigo-600 px-4 py-4 text-sm font-extrabold text-white"
              title="Speak this step"
            >
              🔊
            </button>
            <button
              type="button"
              disabled={activeStepIdx >= route.steps.length - 1}
              onClick={() => {
                const nxt = Math.min(route.steps.length - 1, activeStepIdx + 1);
                handleStepClick(route.steps[nxt], nxt);
              }}
              className="flex-[1.6] rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 py-4 text-sm font-extrabold text-slate-950 shadow-lg disabled:opacity-35"
            >
              Next Step ➡️
            </button>
          </div>
        </div>
      )}

      {/* "SHOW TO A PASSERBY" MULTILINGUAL HELP FLASHCARD MODAL */}
      {helpCardOpen && (
        <div
          onClick={() => setHelpCardOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/92 p-4 backdrop-blur-lg"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-3xl bg-white p-6 text-slate-900 shadow-2xl ring-4 ring-cyan-400 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-indigo-800">
                🙋 Show This Screen to Anyone Nearby
              </span>
              <button
                type="button"
                onClick={() => setHelpCardOpen(false)}
                className="rounded-xl bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
                aria-label="Close help card"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-slate-900 p-4 text-white text-center space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                Destination Needed
              </div>
              <div className="font-display text-2xl sm:text-3xl font-extrabold text-white">
                {destNode?.name || 'Destination'}
              </div>
              <div className="text-xs sm:text-sm font-semibold text-emerald-300">
                {destNode?.building_name || venue.name} ·{' '}
                {formatLevel(destNode?.level ?? 0, destNode?.floor_name)}
              </div>
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
                <div className="text-[11px] font-bold uppercase text-slate-400">English</div>
                <div className="mt-0.5 font-extrabold text-slate-900 text-base">
                  "Excuse me, could you please point me towards {destNode?.name || 'this room'} ({formatLevel(destNode?.level ?? 0, destNode?.floor_name)})?"
                </div>
              </div>

              <div className="rounded-2xl bg-indigo-50/70 p-3.5 ring-1 ring-indigo-200">
                <div className="text-[11px] font-bold uppercase text-indigo-600">ಕನ್ನಡ (Kannada)</div>
                <div className="mt-0.5 font-extrabold text-slate-900 text-base">
                  "ದಯವಿಟ್ಟು ನನಗೆ {destNode?.name || 'ಈ ಸ್ಥಳ'} ({formatLevel(destNode?.level ?? 0, destNode?.floor_name)}) ಕಡೆಗೆ ದಾರಿ ತೋರಿಸಿ."
                </div>
              </div>

              <div className="rounded-2xl bg-emerald-50/70 p-3.5 ring-1 ring-emerald-200">
                <div className="text-[11px] font-bold uppercase text-emerald-700">हिन्दी (Hindi)</div>
                <div className="mt-0.5 font-extrabold text-slate-900 text-base">
                  "कृपया मुझे {destNode?.name || 'इस जगह'} ({formatLevel(destNode?.level ?? 0, destNode?.floor_name)}) का रास्ता बताएं।"
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance(
                      `Excuse me, please point me towards ${destNode?.name || 'my destination'} on ${formatLevel(destNode?.level ?? 0, destNode?.floor_name)}.`,
                    );
                    u.lang = 'en-IN';
                    window.speechSynthesis.speak(u);
                  }
                }}
                className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-600 transition"
              >
                🔊 Speak English
              </button>
              <button
                type="button"
                onClick={() => {
                  if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance(
                      `ದಯವಿಟ್ಟು ನನಗೆ ${destNode?.name || ''} ಕಡೆಗೆ ದಾರಿ ತೋರಿಸಿ.`,
                    );
                    u.lang = 'kn-IN';
                    window.speechSynthesis.speak(u);
                  }
                }}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-500 transition"
              >
                🔊 ಕನ್ನಡದಲ್ಲಿ ಹೇಳಿ
              </button>
              <button
                type="button"
                onClick={() => {
                  if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance(
                      `कृपया मुझे ${destNode?.name || ''} का रास्ता बताएं।`,
                    );
                    u.lang = 'hi-IN';
                    window.speechSynthesis.speak(u);
                  }
                }}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-extrabold text-white hover:bg-emerald-500 transition"
              >
                🔊 हिन्दी में बोलें
              </button>
            </div>
          </div>
        </div>
      )}

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
