import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  Camera,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Search,
  Users,
  X,
} from 'lucide-react';
import { PhotoLocateModal, type ConfirmedSpot } from '../components/PhotoLocateModal';
import { StatusChip, VenueTypeBadge } from '../components/StatusChip';
import { ErrorState } from '../components/ErrorState';
import { getVenue, getVenueGraph, getVenuePeople } from '../lib/api';
import { formatLevel, useVisitorLocation } from '../lib/locationStore';
import type { Graph, Person, PersonStatus, VenueDetail } from '../lib/types';

const STATUS_FILTERS: { key: 'all' | PersonStatus; label: string }[] = [
  { key: 'all', label: 'All Statuses' },
  { key: 'available', label: 'Available' },
  { key: 'busy', label: 'Busy' },
  { key: 'moved', label: 'Moved' },
  { key: 'leave', label: 'On Leave' },
];

export const PeoplePage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { location: visitorLoc, setLocation: setVisitorLoc } = useVisitorLocation(slug);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PersonStatus>('all');

  const [locateOpen, setLocateOpen] = useState(false);
  const [queuedDest, setQueuedDest] = useState<{
    nodeId: string;
    name: string;
  } | null>(null);

  const loadDirectory = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [v, g, p] = await Promise.all([
        getVenue(slug),
        getVenueGraph(slug),
        getVenuePeople(slug),
      ]);
      setVenue(v);
      setGraph(g);
      setPeople(p);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load directory.',
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    people.forEach((p) => {
      if (p.department) set.add(p.department);
    });
    return Array.from(set).sort();
  }, [people]);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (deptFilter !== 'all' && p.department !== deptFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q) ||
        p.node_name.toLowerCase().includes(q)
      );
    });
  }, [people, query, deptFilter, statusFilter]);

  const handleNavigatePerson = (person: Person) => {
    if (visitorLoc?.nodeId) {
      navigate(
        `/v/${slug}/route?from=${encodeURIComponent(visitorLoc.nodeId)}&to=${encodeURIComponent(person.target_node_id)}`,
      );
      return;
    }
    setQueuedDest({ nodeId: person.target_node_id, name: person.name });
    setLocateOpen(true);
  };

  const handleSpotConfirmed = (spot: ConfirmedSpot) => {
    setVisitorLoc({
      nodeId: spot.nodeId,
      name: spot.name,
      buildingName: spot.buildingName,
      level: spot.level,
      floorName: spot.floorName,
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm font-medium text-slate-600">
          Loading live staff & doctor directory...
        </p>
      </div>
    );
  }

  if (error || !venue || !graph) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <ErrorState
          message={error || 'Directory unavailable.'}
          onRetry={() => void loadDirectory()}
        />
      </div>
    );
  }

  const pageHeading =
    venue.type === 'hospital'
      ? 'Doctors, Specialists & Clinical Directory'
      : venue.type === 'campus'
        ? 'Faculty, Deans & Lab Directory'
        : 'People & Officer Directory';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Sticky Top Bar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070B18]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex items-center gap-3">
            <Link
              to={`/v/${slug}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08] text-slate-200 ring-1 ring-white/10 hover:bg-white/15 transition"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-base sm:text-lg font-extrabold">
                  {venue.name}
                </h1>
                <VenueTypeBadge type={venue.type} dark />
              </div>
              <p className="text-xs text-slate-400">{pageHeading}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setQueuedDest(null);
              setLocateOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500/15 px-3.5 py-2 text-xs font-bold text-cyan-300 ring-1 ring-cyan-400/35 hover:bg-cyan-500/25 transition"
          >
            <Camera className="h-3.5 w-3.5" />
            {visitorLoc ? `At: ${visitorLoc.name}` : 'Set My Location via Photo'}
          </button>
        </div>
      </header>

      {/* Filter Hero */}
      <div className="bg-[#0B1228] text-white border-b border-white/10 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold">
                {pageHeading}
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                Real-time cabin availability. When a doctor or faculty member temporarily moves to another wing or OT, routing updates automatically.
              </p>
            </div>
          </div>

          {/* Search + Status Pills */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, specialty, department, or cabin..."
                className="input-dark pl-10 pr-9 py-2.5"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {STATUS_FILTERS.map((sf) => (
                <button
                  key={sf.key}
                  type="button"
                  onClick={() => setStatusFilter(sf.key)}
                  className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    statusFilter === sf.key
                      ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-sm'
                      : 'bg-white/[0.07] text-slate-300 ring-1 ring-white/10 hover:bg-white/15'
                  }`}
                >
                  {sf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Department Filter Pills */}
          {departments.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
              <button
                type="button"
                onClick={() => setDeptFilter('all')}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition ${
                  deptFilter === 'all'
                    ? 'bg-white text-slate-950'
                    : 'bg-white/[0.05] text-slate-300 hover:bg-white/10'
                }`}
              >
                All Departments ({people.length})
              </button>
              {departments.map((dept) => (
                <button
                  key={dept}
                  type="button"
                  onClick={() => setDeptFilter(dept)}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition ${
                    deptFilter === dept
                      ? 'bg-white text-slate-950'
                      : 'bg-white/[0.05] text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* People Cards Grid */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8">
        {filteredPeople.length === 0 ? (
          <div className="card p-12 text-center">
            <Users className="h-8 w-8 text-slate-400 mx-auto" />
            <h3 className="mt-3 font-display text-base font-bold text-slate-900">
              No matching people found
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Try adjusting your department or availability filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPeople.map((person) => {
              const targetNode = graph.nodes.find(
                (n) => n.id === person.target_node_id,
              );
              const isRelocated =
                person.status === 'moved' ||
                person.target_node_id !== person.node_id;

              return (
                <div
                  key={person.id}
                  className="card p-5 flex flex-col justify-between gap-4 hover:shadow-lift transition"
                >
                  <div className="space-y-3.5">
                    {/* Avatar + Identity + Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-extrabold text-white shadow-sm"
                          style={{
                            backgroundColor: person.avatar_color || '#4f46e5',
                          }}
                        >
                          {person.name
                            .split(' ')
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-display text-base font-extrabold text-slate-900 truncate">
                            {person.name}
                          </h3>
                          <p className="text-xs font-semibold text-indigo-600 truncate">
                            {person.title}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {person.department}
                          </p>
                        </div>
                      </div>
                      <StatusChip status={person.status} />
                    </div>

                    {/* Cabin & Schedule Metadata */}
                    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70 space-y-1.5 text-xs">
                      <div className="flex items-center gap-2 text-slate-700">
                        <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          <strong>Primary Cabin:</strong> {person.building_name} ·{' '}
                          {formatLevel(person.level)} · {person.node_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{person.schedule}</span>
                      </div>
                    </div>

                    {/* Live Status / Relocation Note */}
                    {person.status_note && (
                      <div
                        className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium ring-1 ${
                          person.status === 'moved'
                            ? 'bg-sky-50 text-sky-900 ring-sky-200'
                            : person.status === 'leave'
                              ? 'bg-rose-50 text-rose-900 ring-rose-200'
                              : 'bg-amber-50 text-amber-900 ring-amber-200'
                        }`}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <div>
                          <div>{person.status_note}</div>
                          {isRelocated && targetNode && (
                            <div className="mt-0.5 font-bold">
                              Routing updated → {targetNode.name} (
                              {formatLevel(targetNode.level, targetNode.floor_name)})
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Button */}
                  <button
                    type="button"
                    disabled={person.status === 'leave'}
                    onClick={() => handleNavigatePerson(person)}
                    className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                      person.status === 'leave'
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : isRelocated
                          ? 'bg-sky-600 text-white hover:bg-sky-500 shadow-sm'
                          : 'bg-slate-900 text-white hover:bg-indigo-600 shadow-sm'
                    }`}
                  >
                    {person.status === 'leave' ? (
                      <>Currently On Leave</>
                    ) : (
                      <>
                        <Navigation className="h-3.5 w-3.5" />
                        {isRelocated
                          ? `Navigate to Current Spot (${targetNode?.name || 'Updated'})`
                          : `Navigate to ${person.node_name}`}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <PhotoLocateModal
        open={locateOpen}
        onClose={() => {
          setLocateOpen(false);
          setQueuedDest(null);
        }}
        venue={venue}
        nodes={graph.nodes}
        queuedDestination={queuedDest}
        onConfirmedLocation={handleSpotConfirmed}
      />
    </div>
  );
};
