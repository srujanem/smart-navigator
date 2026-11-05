import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Plus,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import {
  createAdminPerson,
  getVenueGraph,
  getVenuePeople,
  updateAdminPerson,
} from '../../lib/api';
import { formatLevel } from '../../lib/locationStore';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type {
  GNode,
  Person,
  PersonStatus,
} from '../../lib/types';

const STATUS_OPTIONS: { value: PersonStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'busy', label: 'Busy' },
  { value: 'moved', label: 'Moved' },
  { value: 'leave', label: 'On Leave' },
];

export const AdminPeoplePage: React.FC = () => {
  const { selectedSlug, selectedVenue } = useAdminVenue();

  const [people, setPeople] = useState<Person[]>([]);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  // Add Person Modal State
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    title: '',
    role: 'Doctor',
    department: '',
    node_id: '',
    schedule: 'Mon–Sat · 9:00 AM – 4:00 PM',
  });

  const loadData = useCallback(async () => {
    if (!selectedSlug) return;
    setLoading(true);
    setError(null);
    try {
      const [pList, g] = await Promise.all([
        getVenuePeople(selectedSlug),
        getVenueGraph(selectedSlug),
      ]);
      setPeople(pList);
      const places = g.nodes.filter((n) => n.is_place);
      setNodes(places);
      const drafts: Record<string, string> = {};
      pList.forEach((p) => {
        drafts[p.id] = p.status_note || '';
      });
      setNoteDrafts(drafts);
      if (places.length > 0) {
        setForm((prev) => ({ ...prev, node_id: prev.node_id || places[0].id }));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load staff directory.',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.node_name.toLowerCase().includes(q),
    );
  }, [people, query]);

  const patchPerson = async (
    person: Person,
    patch: {
      status?: PersonStatus;
      status_note?: string;
      target_node_id?: string;
    },
  ) => {
    setSavingId(person.id);
    try {
      const updated = await updateAdminPerson(person.id, patch);
      setPeople((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNoteDrafts((prev) => ({
        ...prev,
        [updated.id]: updated.status_note || '',
      }));
      setSavedId(person.id);
      window.setTimeout(() => {
        setSavedId((cur) => (cur === person.id ? null : cur));
      }, 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !form.name.trim() || !form.node_id) return;
    setCreating(true);
    try {
      const created = await createAdminPerson(selectedSlug, {
        name: form.name.trim(),
        role: form.role.trim() || 'Staff',
        title: form.title.trim(),
        department: form.department.trim(),
        node_id: form.node_id,
        schedule: form.schedule.trim(),
      });
      setPeople((prev) => [created, ...prev]);
      setNoteDrafts((prev) => ({ ...prev, [created.id]: created.status_note || '' }));
      setAddOpen(false);
      setForm((prev) => ({
        ...prev,
        name: '',
        title: '',
        department: '',
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not add person.');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm text-slate-500">
          Loading staff & doctor directory...
        </p>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void loadData()} />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950">
            Staff & Doctor Directory Manager
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            {selectedVenue?.name} · Update live availability or temporarily redirect visitors to a relocated room/OT
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="btn-primary text-xs font-extrabold py-2.5 px-4"
        >
          <Plus className="h-4 w-4" />
          Add Doctor / Staff
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search directory by name, department, cabin..."
          className="input pl-10"
        />
      </div>

      {/* Directory Rows */}
      <div className="space-y-3.5">
        {filtered.map((person) => {
          const isSaving = savingId === person.id;
          const isSaved = savedId === person.id;
          const draftNote = noteDrafts[person.id] ?? '';

          return (
            <div
              key={person.id}
              className="card p-5 space-y-4 transition hover:shadow-md"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Identity */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold text-white"
                    style={{ backgroundColor: person.avatar_color || '#4f46e5' }}
                  >
                    {person.name
                      .split(' ')
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-bold text-slate-900 truncate">
                        {person.name}
                      </h3>
                      <StatusChip status={person.status} />
                      {isSaving && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                      )}
                      {isSaved && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                          <Check className="h-3.5 w-3.5" /> Saved
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      {person.title} · {person.department} · Primary Cabin:{' '}
                      <strong className="text-slate-700">{person.node_name}</strong> (
                      {person.building_name})
                    </p>
                  </div>
                </div>

                {/* Inline Live Status Switcher */}
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1">
                  {STATUS_OPTIONS.map((opt) => {
                    const active = person.status === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          void patchPerson(person, {
                            status: opt.value,
                            target_node_id:
                              opt.value === 'available'
                                ? person.node_id
                                : person.target_node_id,
                          })
                        }
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          active
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Inline Relocation Node Selector + Status Note */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-100">
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Active Routing Target (Cabin or Moved-To Spot)
                  </label>
                  <select
                    value={person.target_node_id}
                    onChange={(e) =>
                      void patchPerson(person, {
                        target_node_id: e.target.value,
                        status:
                          e.target.value !== person.node_id
                            ? 'moved'
                            : person.status,
                      })
                    }
                    className="input py-2 text-xs"
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.building_name} · {formatLevel(n.level, n.floor_name)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-7">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Live Visitor Status Note
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftNote}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [person.id]: e.target.value,
                        }))
                      }
                      placeholder='e.g. "In OT-2 until 4 PM — routing updated"'
                      className="input py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void patchPerson(person, { status_note: draftNote })
                      }
                      className="btn-indigo py-2 px-3.5 text-xs shrink-0"
                    >
                      Save Note
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Doctor / Staff Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
                  <UserPlus className="h-4 w-4" />
                </div>
                <h2 className="font-display text-lg font-extrabold text-slate-900">
                  Add Doctor, Faculty or Staff
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreate(e)} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Full Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Dr. Ananya Rao"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Role</label>
                  <input
                    type="text"
                    required
                    value={form.role}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, role: e.target.value }))
                    }
                    placeholder="Doctor / Professor / Officer"
                    className="input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Title / Designation</label>
                  <input
                    type="text"
                    required
                    value={form.title}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                    placeholder="Senior Cardiologist"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Department</label>
                  <input
                    type="text"
                    required
                    value={form.department}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, department: e.target.value }))
                    }
                    placeholder="Cardiology"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="label">Primary Cabin / Room Node</label>
                <select
                  required
                  value={form.node_id}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, node_id: e.target.value }))
                  }
                  className="input"
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.building_name} · {formatLevel(n.level, n.floor_name)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Visiting Schedule</label>
                <input
                  type="text"
                  required
                  value={form.schedule}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, schedule: e.target.value }))
                  }
                  placeholder="Mon–Fri · 10:00 AM – 4:00 PM"
                  className="input"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-primary text-xs px-5"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
