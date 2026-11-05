import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Briefcase,
  Camera,
  CheckCircle2,
  Compass,
  Cpu,
  Cuboid,
  EyeOff,
  FileSearch,
  GraduationCap,
  Hospital,
  Languages,
  Layers,
  Lock,
  Map as MapIcon,
  Navigation,
  Radio,
  Route as RouteIcon,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { VenueCard } from '../components/VenueCard';
import { ErrorState, Skeleton3D } from '../components/ErrorState';
import { getHealth, getVenues } from '../lib/api';
import type { HealthStatus, VenueSummary } from '../lib/types';

const Hero3D = lazy(() => import('../components/Hero3D'));

const HOW_IT_WORKS_STEPS = [
  {
    num: '01',
    title: 'Snap or upload where you stand',
    subtitle: 'Still photo · Zero app install · Instant EXIF stripping',
    description:
      'Take a single still photo of any hallway, reception desk, clinic signboard, or building atrium right from your mobile browser — or pick from sample visitor shots.',
    icon: Camera,
    accent: 'from-cyan-400 to-sky-500',
    highlights: [
      'Works on any smartphone or laptop browser',
      'No continuous camera stream or battery drain',
      'Optional floor hint or automatic multi-floor detection',
    ],
  },
  {
    num: '02',
    title: 'DINOv2 + Signboard OCR pinpoint your spot',
    subtitle: 'Visual feature embeddings fused with scene text',
    description:
      'Navigator extracts dense visual descriptors alongside multi-script signboard OCR to distinguish visually similar corridors across floors and wings.',
    icon: Cpu,
    accent: 'from-indigo-400 to-violet-500',
    highlights: [
      'Side-by-side reference photo verification',
      'Reads room numbers, ward boards & directional signs',
      'Transparent AI pipeline trace on every localization',
    ],
  },
  {
    num: '03',
    title: 'Visual photo-by-photo A* routing to any room or doctor',
    subtitle: 'Multi-building · Lift-only stretcher mode · Live closures',
    description:
      'Follow clear landmark photos and voice instructions in English, Hindi, Tamil, or Telugu — automatically routing around closed corridors or relocated doctors.',
    icon: RouteIcon,
    accent: 'from-emerald-400 to-teal-500',
    highlights: [
      'Wheelchair & hospital stretcher lift-only routing',
      'Live doctor & faculty availability + cabin relocation updates',
      'Interactive 3D spatial twin & 2D floor blueprints',
    ],
  },
];

const INDOOR_WORLDS = [
  {
    title: 'Multi-Speciality Hospitals',
    badge: 'Healthcare',
    icon: Hospital,
    gradient: 'from-rose-500/20 via-rose-500/5 to-transparent',
    border: 'hover:ring-rose-400/40',
    iconBg: 'bg-rose-500/15 text-rose-400 ring-rose-400/30',
    description:
      'Guide anxious patients and families straight to OPD clinics, Cardiology, X-Ray & MRI suites, billing counters, and on-duty specialists.',
    features: [
      '1-Tap Emergency Department routing',
      'Stretcher & wheelchair lift-only paths',
      'Live doctor cabin & OT relocation status',
    ],
  },
  {
    title: 'University Campuses',
    badge: 'Higher Education',
    icon: GraduationCap,
    gradient: 'from-indigo-500/20 via-indigo-500/5 to-transparent',
    border: 'hover:ring-indigo-400/40',
    iconBg: 'bg-indigo-500/15 text-indigo-400 ring-indigo-400/30',
    description:
      'Connect sprawling academic blocks, AI & robotics labs, lecture theatres, libraries, hostels, and faculty cabins across outdoor walkways and multi-story wings.',
    features: [
      'Faculty cabin directory & visiting hours',
      'Exam hall & lab search by course or topic',
      'Cross-building outdoor + indoor routing',
    ],
  },
  {
    title: 'Airports & Shopping Malls',
    badge: 'Transit & Retail',
    icon: ShoppingBag,
    gradient: 'from-amber-500/20 via-amber-500/5 to-transparent',
    border: 'hover:ring-amber-400/40',
    iconBg: 'bg-amber-500/15 text-amber-400 ring-amber-400/30',
    description:
      'Turn any concourse pillar or storefront photo into immediate directions to boarding gates, anchor stores, lounges, washrooms, and family elevators.',
    features: [
      'Natural intent queries ("nearest washroom")',
      'Stroller & luggage accessible lift paths',
      'Instant escalator/corridor maintenance rerouting',
    ],
  },
  {
    title: 'Civic & Tech Parks',
    badge: 'Enterprise & Public',
    icon: Briefcase,
    gradient: 'from-cyan-500/20 via-cyan-500/5 to-transparent',
    border: 'hover:ring-cyan-400/40',
    iconBg: 'bg-cyan-500/15 text-cyan-400 ring-cyan-400/30',
    description:
      'Help visitors, citizens, and new hires navigate multi-tower campuses, public service counters, conference suites, and skybridges effortlessly.',
    features: [
      'Zero hardware beacons or Wi-Fi modifications',
      'Officer & service counter live status',
      'Self-serve Admin Studio dataset builder',
    ],
  },
];

export const LandingPage: React.FC = () => {
  const [venues, setVenues] = useState<VenueSummary[]>([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [venuesError, setVenuesError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  const loadData = useCallback(async () => {
    setLoadingVenues(true);
    setVenuesError(null);
    try {
      const [vList, hStatus] = await Promise.all([
        getVenues(),
        getHealth().catch(() => null),
      ]);
      setVenues(vList);
      if (hStatus) setHealth(hStatus);
    } catch (err) {
      setVenuesError(
        err instanceof Error
          ? err.message
          : 'Could not load live venues from the API server.',
      );
    } finally {
      setLoadingVenues(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="min-h-screen bg-[#070B18] text-white selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar variant="dark" />

      {/* =================================================================== */}
      {/* HERO SECTION WITH INTERACTIVE 3D ARCHITECTURAL TWIN                 */}
      {/* =================================================================== */}
      <section className="relative overflow-hidden border-b border-white/[0.08] spatial-grid-dark">
        {/* Animated Aurora Light Orbs */}
        <div className="aurora-orb pointer-events-none absolute -top-36 left-1/5 h-[36rem] w-[36rem] rounded-full bg-cyan-500/20 blur-[135px]" />
        <div className="aurora-orb pointer-events-none absolute top-20 right-1/5 h-[32rem] w-[32rem] rounded-full bg-indigo-600/25 blur-[145px]" />
        <div className="pointer-events-none absolute -bottom-28 left-1/2 -translate-x-1/2 h-[22rem] w-[44rem] rounded-full bg-emerald-500/10 blur-[130px]" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-10 pb-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
            {/* Hero Copy */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              className="lg:col-span-6 space-y-6 z-10"
            >
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-cyan-300 ring-1 ring-white/15 backdrop-blur-md shadow-lg shadow-black/20">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                <span>Flagship Spatial AI & 3D Digital Twin Platform</span>
                {health && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {health.embedder} Active
                  </span>
                )}
              </div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.55rem] font-extrabold tracking-tight leading-[1.05] text-white">
                Lost inside a massive building?{' '}
                <span className="bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 bg-clip-text text-transparent">
                  Snap one photo.
                </span>{' '}
                Walk in 3D clarity.
              </h1>

              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-xl">
                GPS stops at the front door. Navigator fuses DINOv2 visual geometry with signboard OCR on a single still photo — launching Cinema Street-View turn chevrons, realistic glass 3D architectural twins, and 5-language voice guidance.
              </p>

              {/* Primary CTAs */}
              <div className="flex flex-wrap items-center gap-3.5 pt-1">
                <Link
                  to="/venues"
                  className="inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-600 px-6 py-3.5 text-sm font-extrabold text-white shadow-xl shadow-cyan-500/30 hover:from-cyan-300 hover:to-indigo-500 transition-all hover:-translate-y-0.5"
                >
                  <Navigation className="h-4 w-4" />
                  Explore Live Venues
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <Link
                  to="/admin/login?mode=register"
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500/15 px-5 py-3.5 text-sm font-bold text-emerald-200 ring-1 ring-emerald-400/35 hover:bg-emerald-500/25 transition"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Create & Map Your Venue
                </Link>

                <Link
                  to="/admin"
                  className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.07] px-5 py-3.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/[0.12] transition"
                >
                  <Lock className="h-4 w-4 text-cyan-400" />
                  Admin Studio
                </Link>
              </div>

              {/* Architectural Pillar Highlights */}
              <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/10 max-w-lg">
                <div>
                  <div className="text-xs font-bold text-cyan-300">Cinema Street-View</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    3D AR chevrons on real photos
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-indigo-300">Glass 3D Twin</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Animated lifts, stairs & daylight
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-emerald-300">Creator Vault</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Secure multi-uploader studio
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Interactive 3D Architectural Glass Hologram */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65, delay: 0.1 }}
              className="lg:col-span-6 relative h-[420px] sm:h-[490px] lg:h-[540px] rounded-3xl bg-[#0A1024]/90 ring-1 ring-white/15 shadow-[0_25px_70px_-15px_rgba(14,165,233,0.28)] overflow-hidden"
            >
              <Suspense
                fallback={
                  <Skeleton3D label="Rendering 3D Architectural Glass Twin..." />
                }
              >
                <Hero3D />
              </Suspense>

              {/* Floating Hologram HUD Badges */}
              <div className="pointer-events-none absolute top-3.5 left-3.5 flex items-center gap-2 rounded-xl bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-400/30 backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                Live 3D Architectural Twin · Drag to Orbit
              </div>

              <div className="pointer-events-none absolute bottom-3.5 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-950/80 px-4 py-2.5 text-xs ring-1 ring-white/15 backdrop-blur-md">
                <div className="flex items-center gap-2 text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                  <span>Photo Pinpointed: Atrium Entrance</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                  <span>Glass Lift Core → Level 2 Wing</span>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* FLAGSHIP BENTO ARCHITECTURE SHOWCASE                                */}
      {/* =================================================================== */}
      <section className="py-16 sm:py-20 bg-[#050914] border-b border-white/[0.08]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/30">
                <Cuboid className="h-3.5 w-3.5" />
                Next-Gen Spatial Experience
              </span>
              <h2 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                Engineered for Visual Realism & Creator Control
              </h2>
            </div>
            <p className="text-sm text-slate-400 max-w-md">
              Every corridor photo, 3D glass floor slab, signboard OCR box, and uploader account works together seamlessly.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Large Bento 1: Cinema Street-View & 3D Glass Twin */}
            <div className="lg:col-span-7 relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0F1B3D] via-[#0A1228] to-[#060A16] p-6 sm:p-8 ring-1 ring-white/12 shadow-2xl flex flex-col justify-between">
              <div className="pointer-events-none absolute -right-16 -top-16 h-60 w-60 rounded-full bg-cyan-500/20 blur-3xl" />
              <div className="relative z-10 space-y-3">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-2.5 py-1 text-[11px] font-bold text-cyan-300 ring-1 ring-cyan-400/30">
                  <Cuboid className="h-3.5 w-3.5" />
                  3D Glass Architecture + Street-View HUD
                </span>
                <h3 className="font-display text-2xl font-extrabold text-white">
                  Walk through real HDR corridor photos with 3D perspective turn chevrons
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
                  Switch effortlessly between Daylight Architectural Twin and Night Hologram modes, watch glass elevators glide across floors, inspect floating room photo billboards in 3D space, and follow glowing AR-style floor chevrons step by step.
                </p>
              </div>

              <div className="relative z-10 mt-6 grid grid-cols-3 gap-2.5 pt-4 border-t border-white/10 text-xs">
                <div className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
                  <div className="font-extrabold text-cyan-300">Day / Night 3D</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Glass facades & lift shafts</div>
                </div>
                <div className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
                  <div className="font-extrabold text-indigo-300">3D Photo Cards</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Hovering room previews</div>
                </div>
                <div className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
                  <div className="font-extrabold text-emerald-300">AR Chevrons</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Projected onto real photos</div>
                </div>
              </div>
            </div>

            {/* Large Bento 2: Secure Uploader Vault & Visual Map Builder */}
            <div className="lg:col-span-5 relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0D2528] via-[#091824] to-[#060B17] p-6 sm:p-8 ring-1 ring-emerald-400/25 shadow-2xl flex flex-col justify-between">
              <div className="pointer-events-none absolute -left-12 -bottom-12 h-52 w-52 rounded-full bg-emerald-500/15 blur-3xl" />
              <div className="relative z-10 space-y-3">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                  <MapIcon className="h-3.5 w-3.5" />
                  Secure Map Creator Studio
                </span>
                <h3 className="font-display text-2xl font-extrabold text-white">
                  Build your own indoor map by clicking blueprints & uploading photos
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Create a PBKDF2-secured uploader account, generate a blank venue, click to place rooms & lifts on your floor plan, and upload reference photos — isolated strictly to your profile vault.
                </p>
              </div>

              <div className="relative z-10 mt-6 flex flex-wrap items-center gap-2.5 pt-4 border-t border-white/10">
                <Link
                  to="/admin/login?mode=register"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 transition shadow-lg shadow-emerald-500/20"
                >
                  Create Uploader Account
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/admin/map-editor"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white ring-1 ring-white/15 hover:bg-white/15 transition"
                >
                  Visual Map Builder
                </Link>
              </div>
            </div>

            {/* Bottom Row: 3 Compact Flagship Cards */}
            <div className="lg:col-span-4 rounded-3xl bg-[#0B1326] p-6 ring-1 ring-white/10 space-y-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-400/30">
                <Camera className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-bold text-white">
                Laser Scan & Split-Wipe Match
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Inspect glowing signboard OCR bounding boxes and drag the interactive split-wipe slider to verify your uploaded angle against the venue reference.
              </p>
            </div>

            <div className="lg:col-span-4 rounded-3xl bg-[#0B1326] p-6 ring-1 ring-white/10 space-y-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-400/30">
                <Languages className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-bold text-white">
                5-Language Native Voice
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Hands-free turn-by-turn voice narration in English, Kannada (ಕನ್ನಡ), Hindi (हिन्दी), Tamil (தமிழ்), and Telugu (తెలుగు).
              </p>
            </div>

            <div className="lg:col-span-4 rounded-3xl bg-[#0B1326] p-6 ring-1 ring-white/10 space-y-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-400/30">
                <WifiOff className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-bold text-white">
                Offline Basement PWA Routing
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Lost signal inside a radiology basement? Navigator caches the venue graph locally and computes multi-floor A* routes right on your phone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* INTERACTIVE HOW IT WORKS (3-STEP VISUAL FLOW)                       */}
      {/* =================================================================== */}
      <section
        id="how-it-works"
        className="bg-slate-50 text-slate-900 py-20 sm:py-24 border-b border-slate-200/80"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700 ring-1 ring-indigo-200">
              <Layers className="h-3.5 w-3.5" />
              How Navigator Works
            </span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950">
              From a single hallway photo to turn-by-turn indoor clarity
            </h2>
            <p className="mt-3 text-base text-slate-600">
              No mobile app downloads, no Bluetooth calibration, and no QR codes on walls. Every venue runs on pure visual understanding and topological A* routing.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Step Selector Cards */}
            <div className="lg:col-span-7 space-y-4">
              {HOW_IT_WORKS_STEPS.map((st, idx) => {
                const Icon = st.icon;
                const isSelected = activeStep === idx;
                return (
                  <button
                    key={st.num}
                    type="button"
                    onClick={() => setActiveStep(idx)}
                    className={`w-full text-left rounded-2xl p-5 sm:p-6 transition-all ${
                      isSelected
                        ? 'bg-white shadow-lift ring-2 ring-indigo-500'
                        : 'bg-white/75 hover:bg-white ring-1 ring-slate-200/90'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${st.accent} text-white shadow-md`}
                      >
                        <Icon className="h-6 w-6" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                            Step {st.num} · {st.subtitle}
                          </span>
                        </div>
                        <h3 className="mt-1 font-display text-lg font-bold text-slate-900">
                          {st.title}
                        </h3>
                        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                          {st.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Interactive Step Stage Preview */}
            <div className="lg:col-span-5">
              <div className="h-full rounded-3xl bg-[#070B18] p-6 sm:p-7 text-white ring-1 ring-slate-900/10 shadow-xl flex flex-col justify-between spatial-grid-dark">
                <div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                      Pipeline Stage {HOW_IT_WORKS_STEPS[activeStep].num}
                    </span>
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200">
                      Real-Time Spatial Engine
                    </span>
                  </div>

                  <h4 className="mt-5 font-display text-xl font-bold text-white">
                    {HOW_IT_WORKS_STEPS[activeStep].title}
                  </h4>

                  {/* Dynamic Visual Illustration per Step */}
                  <div className="mt-5 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10 space-y-3">
                    {activeStep === 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl bg-cyan-500/10 px-3.5 py-2.5 ring-1 ring-cyan-400/30">
                          <span className="text-xs font-semibold text-cyan-200">
                            📷 visitor_corridor_still.jpg
                          </span>
                          <span className="rounded bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                            EXIF Stripped
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                            <div className="text-slate-400 text-[11px]">Input Mode</div>
                            <div className="font-bold text-white mt-0.5">
                              Still Photo / Drop
                            </div>
                          </div>
                          <div className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                            <div className="text-slate-400 text-[11px]">Privacy Filter</div>
                            <div className="font-bold text-emerald-300 mt-0.5">
                              Auto Face-Blur
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeStep === 1 && (
                      <div className="space-y-2.5 text-xs">
                        <div className="flex items-center justify-between rounded-xl bg-indigo-500/15 px-3 py-2 ring-1 ring-indigo-400/30">
                          <span className="font-semibold text-indigo-200">
                            DINOv2 Cosine Embedding Match
                          </span>
                          <span className="font-mono text-cyan-300">Visual Vector</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl bg-emerald-500/15 px-3 py-2 ring-1 ring-emerald-400/30">
                          <span className="font-semibold text-emerald-200">
                            Signboard OCR Fusion
                          </span>
                          <span className="font-mono text-emerald-300">
                            "CARDIOLOGY · L2"
                          </span>
                        </div>
                        <div className="rounded-xl bg-white/[0.04] p-2.5 text-[11px] text-slate-300">
                          Side-by-side reference verification ensures you confirm the exact spot before walking.
                        </div>
                      </div>
                    )}

                    {activeStep === 2 && (
                      <div className="space-y-2.5 text-xs">
                        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500 text-slate-950 font-bold">
                            1
                          </span>
                          <div>
                            <div className="font-semibold text-white">
                              Walk straight past Main Reception
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Ground Floor · Landmark photo attached
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500 text-white font-bold">
                            2
                          </span>
                          <div>
                            <div className="font-semibold text-white">
                              Take Central Lift to Floor 2 (Accessible)
                            </div>
                            <div className="text-[10px] text-emerald-300">
                              Closed East Staircase automatically avoided
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <ul className="mt-5 space-y-2.5">
                    {HOW_IT_WORKS_STEPS[activeStep].highlights.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-300"
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Ready to try it in a live building?
                  </span>
                  <Link
                    to="/venues"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300 hover:text-cyan-200"
                  >
                    Open a Venue <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BUILT FOR COMPLEX INDOOR WORLDS                                     */}
      {/* =================================================================== */}
      <section
        id="worlds"
        className="py-20 sm:py-24 bg-[#070B18] border-b border-white/[0.08]"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/30">
              <Compass className="h-3.5 w-3.5" />
              Universal Spatial Platform
            </span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Built for Complex Indoor Worlds
            </h2>
            <p className="mt-3 text-base text-slate-400">
              One unified graph, vision, and directory architecture tailored to the places where getting lost costs critical time.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
            {INDOOR_WORLDS.map((w) => {
              const Icon = w.icon;
              return (
                <div
                  key={w.title}
                  className={`relative overflow-hidden rounded-3xl bg-[#0C1328] p-6 sm:p-7 ring-1 ring-white/10 transition-all duration-300 ${w.border}`}
                >
                  <div
                    className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${w.gradient}`}
                  />
                  <div className="relative z-10 space-y-4">
                    <div className="flex items-center justify-between">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ${w.iconBg}`}
                      >
                        <Icon className="h-6 w-6" />
                      </div>
                      <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-white/10">
                        {w.badge}
                      </span>
                    </div>

                    <h3 className="font-display text-xl font-bold text-white">
                      {w.title}
                    </h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {w.description}
                    </p>

                    <div className="pt-2 space-y-2 border-t border-white/[0.08]">
                      {w.features.map((f, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-xs text-slate-300"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* LIVE VENUES PREVIEW (FROM GET /api/venues)                          */}
      {/* =================================================================== */}
      <section className="py-20 sm:py-24 bg-slate-50 text-slate-900 border-b border-slate-200/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
                <Radio className="h-3.5 w-3.5 text-emerald-600" />
                Live Spatial Twins
              </span>
              <h2 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950">
                Explore Active Venues
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Select any venue below to test 1-click visitor photo localization, smart doctor/room search, and 3D multi-floor routing.
              </p>
            </div>
            <Link
              to="/venues"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition shrink-0"
            >
              View All Venues
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loadingVenues ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-96 rounded-2xl bg-white ring-1 ring-slate-200 p-4 animate-pulse flex flex-col justify-between"
                >
                  <div className="h-44 rounded-xl bg-slate-200" />
                  <div className="space-y-3">
                    <div className="h-4 w-2/3 rounded bg-slate-200" />
                    <div className="h-3 w-full rounded bg-slate-100" />
                    <div className="h-12 w-full rounded-xl bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : venuesError ? (
            <ErrorState
              title="Backend Venue Service Starting Up"
              message={venuesError}
              onRetry={() => void loadData()}
            />
          ) : venues.length === 0 ? (
            <div className="rounded-2xl bg-white p-10 text-center ring-1 ring-slate-200">
              <p className="text-sm text-slate-600">
                No venues are indexed yet. Open Admin Studio to configure a venue.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {venues.slice(0, 6).map((venue) => (
                <VenueCard key={venue.id} venue={venue} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* =================================================================== */}
      {/* PRIVACY & ZERO-HARDWARE ARCHITECTURE                                */}
      {/* =================================================================== */}
      <section id="privacy" className="py-20 sm:py-24 bg-[#070B18] text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-br from-[#0D1630] via-[#0B1226] to-[#070B18] p-8 sm:p-12 ring-1 ring-white/10 shadow-2xl">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/30">
                <ShieldCheck className="h-3.5 w-3.5" />
                Privacy-By-Design & Zero Hardware
              </span>
              <h2 className="mt-3 font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
                Engineered for medical & institutional trust
              </h2>
              <p className="mt-2.5 text-sm sm:text-base text-slate-300 leading-relaxed">
                Navigator requires zero physical installation on hospital or campus walls and treats every uploaded query image with strict automated privacy safeguards.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 space-y-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <EyeOff className="h-5 w-5" />
                </div>
                <h3 className="font-display text-sm font-bold">
                  Automatic Face Blurring
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Bystander faces detected in visitor or admin photos are blurred automatically before storage or optional dataset contribution.
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 space-y-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400">
                  <FileSearch className="h-5 w-5" />
                </div>
                <h3 className="font-display text-sm font-bold">
                  Instant EXIF Stripping
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Device serials, timestamps, and camera metadata headers are stripped on ingestion so uploads remain anonymous.
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 space-y-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
                  <WifiOff className="h-5 w-5" />
                </div>
                <h3 className="font-display text-sm font-bold">
                  Zero BLE Beacons or Tags
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Deploy across an entire hospital or university using ordinary hallway photos — no battery beacons, Wi-Fi sniffing, or wall stickers.
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 space-y-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h3 className="font-display text-sm font-bold">
                  No Live Person Tracking
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Localization happens strictly on-demand when you choose to upload a still photo — never via background tracking or live video feeds.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* FOOTER                                                              */}
      {/* =================================================================== */}
      <footer className="border-t border-white/[0.08] bg-[#050812] py-10 text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 text-white">
              <Compass className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold text-white">
              Navigator
            </span>
            <span className="text-xs text-slate-500">
              · Universal Visual Indoor Navigation
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs font-medium">
            <Link to="/venues" className="hover:text-white transition">
              Live Venues
            </Link>
            <a href="#how-it-works" className="hover:text-white transition">
              How It Works
            </a>
            <a href="#privacy" className="hover:text-white transition">
              Privacy
            </a>
            <Link to="/admin" className="hover:text-cyan-300 transition">
              Admin Studio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
