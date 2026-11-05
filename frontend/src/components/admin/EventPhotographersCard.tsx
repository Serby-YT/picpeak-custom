import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { ExternalLink, Pencil, Plus, X } from "lucide-react";
import { Button, Card, Input } from "../common";
import {
  photographersService,
  type EventCredit,
  type Photographer,
  type PhotographerInput,
} from "../../services/photographers.service";

interface EventPhotographersCardProps {
  eventId: number;
}

const emptyForm: PhotographerInput = { name: "", portfolio_url: "", default_role: "" };

const apiError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return message || fallback;
};

/**
 * Other photographers credited on this gallery. Picked from a saved list
 * (typed once, reused on every gallery); each gets an optional role here.
 * Shown in the gallery hero, each linking to their portfolio. Every change
 * saves immediately.
 */
export const EventPhotographersCard: React.FC<EventPhotographersCardProps> = ({ eventId }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const creditsKey = ["event-photographers", eventId];

  const { data: credits = [], isLoading } = useQuery({
    queryKey: creditsKey,
    queryFn: () => photographersService.getEventCredits(eventId),
  });
  const { data: saved = [] } = useQuery({
    queryKey: ["photographers"],
    queryFn: () => photographersService.list(),
  });

  // Role drafts, saved on blur so typing does not fire a request per key
  const [roles, setRoles] = useState<Record<number, string>>({});
  useEffect(() => {
    setRoles(Object.fromEntries(credits.map(c => [c.photographer_id, c.role || ""])));
  }, [credits]);

  const [form, setForm] = useState<PhotographerInput>(emptyForm);
  const [formMode, setFormMode] = useState<"closed" | "new" | number>("closed");

  const saveCredits = useMutation({
    mutationFn: (next: Array<{ photographer_id: number; role: string | null }>) =>
      photographersService.saveEventCredits(eventId, next),
    onSuccess: (data) => {
      queryClient.setQueryData(creditsKey, data);
      queryClient.invalidateQueries({ queryKey: ["photographers"] });
    },
    onError: (error) => toast.error(apiError(error, t("photographers.saveError", "Could not save the photographers"))),
  });

  const asPayload = (list: EventCredit[]) =>
    list.map(c => ({ photographer_id: c.photographer_id, role: (roles[c.photographer_id] ?? c.role ?? "").trim() || null }));

  const addCredit = (photographer: Photographer) => {
    if (credits.some(c => c.photographer_id === photographer.id)) return;
    saveCredits.mutate([
      ...asPayload(credits),
      { photographer_id: photographer.id, role: photographer.default_role || null },
    ]);
  };

  const removeCredit = (photographerId: number) => {
    saveCredits.mutate(asPayload(credits.filter(c => c.photographer_id !== photographerId)));
  };

  const commitRole = (photographerId: number) => {
    const credit = credits.find(c => c.photographer_id === photographerId);
    if (!credit || (roles[photographerId] || "").trim() === (credit.role || "")) return;
    saveCredits.mutate(asPayload(credits));
  };

  const savePhotographer = useMutation({
    mutationFn: async () => {
      const input = {
        name: form.name.trim(),
        portfolio_url: form.portfolio_url.trim(),
        default_role: (form.default_role || "").trim() || null,
      };
      if (formMode === "new") return { created: true, photographer: await photographersService.create(input) };
      return { created: false, photographer: await photographersService.update(formMode as number, input) };
    },
    onSuccess: ({ created, photographer }) => {
      setFormMode("closed");
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["photographers"] });
      if (created) {
        addCredit(photographer);
      } else {
        queryClient.invalidateQueries({ queryKey: creditsKey });
        toast.success(t("photographers.updated", "Updated on every gallery that credits them"));
      }
    },
    onError: (error) => toast.error(apiError(error, t("photographers.saveError", "Could not save the photographers"))),
  });

  const deletePhotographer = useMutation({
    mutationFn: (id: number) => photographersService.remove(id),
    onSuccess: () => {
      setFormMode("closed");
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["photographers"] });
      queryClient.invalidateQueries({ queryKey: creditsKey });
    },
    onError: (error) => toast.error(apiError(error, t("photographers.deleteError", "Could not delete the photographer"))),
  });

  const openEdit = (id: number) => {
    const p = saved.find(s => s.id === id);
    if (!p) return;
    setForm({ name: p.name, portfolio_url: p.portfolio_url, default_role: p.default_role || "" });
    setFormMode(id);
  };

  const confirmDelete = (id: number) => {
    const p = saved.find(s => s.id === id);
    if (!p) return;
    const count = p.gallery_count || 0;
    const question = t("photographers.confirmDelete", {
      defaultValue: "Delete {{name}} from your saved list? They will be removed from {{count}} gallery/galleries.",
      name: p.name,
      count,
    });
    if (window.confirm(question)) deletePhotographer.mutate(id);
  };

  const available = saved.filter(p => !credits.some(c => c.photographer_id === p.id));
  const busy = saveCredits.isPending || savePhotographer.isPending || deletePhotographer.isPending;

  return (
    <Card padding="md">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
        {t("photographers.title", "Photographers")}
      </h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
        {t("photographers.help", "Other photographers who worked this event. Shown under the gallery hero, each linking to their portfolio.")}
      </p>

      {isLoading ? null : credits.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          {t("photographers.none", "Nobody else is credited on this gallery.")}
        </p>
      ) : (
        <ul className="space-y-3 mb-4">
          {credits.map(credit => (
            <li key={credit.photographer_id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{credit.name}</div>
                <a
                  href={credit.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1 max-w-full"
                >
                  <span className="truncate">{credit.portfolio_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <ExternalLink className="w-3 h-3 flex-none" aria-hidden="true" />
                </a>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={roles[credit.photographer_id] ?? ""}
                  onChange={e => setRoles(prev => ({ ...prev, [credit.photographer_id]: e.target.value }))}
                  onBlur={() => commitRole(credit.photographer_id)}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  maxLength={60}
                  placeholder={t("photographers.rolePlaceholder", "Role, e.g. Video")}
                  aria-label={t("photographers.role", "Role")}
                  className="w-full sm:w-36 px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                />
                <button
                  type="button"
                  onClick={() => openEdit(credit.photographer_id)}
                  className="p-2 rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                  aria-label={t("photographers.edit", "Edit saved details")}
                  title={t("photographers.edit", "Edit saved details")}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeCredit(credit.photographer_id)}
                  disabled={busy}
                  className="p-2 rounded-md text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                  aria-label={t("photographers.removeFromGallery", "Remove from this gallery")}
                  title={t("photographers.removeFromGallery", "Remove from this gallery")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formMode === "closed" ? (
        <div className="flex flex-col sm:flex-row gap-2">
          {available.length > 0 && (
            <select
              value=""
              onChange={e => {
                const p = available.find(a => a.id === Number(e.target.value));
                if (p) addCredit(p);
              }}
              disabled={busy}
              aria-label={t("photographers.addSaved", "Add from saved list")}
              className="flex-1 px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            >
              <option value="">{t("photographers.addSaved", "Add from saved list")}…</option>
              {available.map(p => (
                <option key={p.id} value={p.id}>
                  {p.default_role ? `${p.name} (${p.default_role})` : p.name}
                </option>
              ))}
            </select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => { setForm(emptyForm); setFormMode("new"); }}
          >
            {t("photographers.new", "New photographer")}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60"
          onSubmit={e => { e.preventDefault(); savePhotographer.mutate(); }}
        >
          <Input
            label={t("photographers.name", "Name")}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            maxLength={100}
            required
            autoFocus
          />
          <Input
            label={t("photographers.portfolio", "Portfolio link")}
            value={form.portfolio_url}
            onChange={e => setForm(f => ({ ...f, portfolio_url: e.target.value }))}
            placeholder="https://"
            maxLength={500}
            required
          />
          <Input
            label={t("photographers.defaultRole", "Default role (optional)")}
            value={form.default_role || ""}
            onChange={e => setForm(f => ({ ...f, default_role: e.target.value }))}
            placeholder={t("photographers.rolePlaceholder", "Role, e.g. Video")}
            maxLength={60}
          />
          {typeof formMode === "number" && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t("photographers.editNote", "Changes apply to every gallery that credits them.")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" isLoading={savePhotographer.isPending}>
              {formMode === "new" ? t("photographers.saveAndAdd", "Save and add") : t("common.save", "Save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setFormMode("closed"); setForm(emptyForm); }}>
              {t("common.cancel", "Cancel")}
            </Button>
            {typeof formMode === "number" && (
              <button
                type="button"
                onClick={() => confirmDelete(formMode)}
                className="ml-auto text-sm text-red-600 hover:underline"
              >
                {t("photographers.deleteSaved", "Delete from saved list")}
              </button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
};

EventPhotographersCard.displayName = "EventPhotographersCard";
