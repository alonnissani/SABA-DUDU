import { useState } from 'react';
import type { ItemKind } from '../../../shared/types';
import { ITEM_KINDS, KIND_LABELS, formatBytes } from '../../../shared/constants';
import { api } from '../../api/client';
import { useLoad, useToast } from '../../state';
import { ErrorBox, Spinner } from '../../components/Common';
import { Icon, KIND_ICON } from '../../components/Icon';
import { ItemRowCard } from '../../components/ItemCards';
import { formatDate } from '../../lib/media';

export function ContentSection() {
  const toast = useToast();
  const [view, setView] = useState<'trash' | ItemKind>('trash');
  const stats = useLoad(() => api.admin.stats(), []);
  const list = useLoad(() => (view === 'trash' ? api.list({ deleted: true, limit: 100 }) : api.list({ kind: view, limit: 100 })), [view]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      list.reload();
      stats.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="stack">
      {stats.data && (
        <div className="stats">
          {ITEM_KINDS.map((k) => (
            <div key={k} className="stat">
              <Icon name={KIND_ICON[k]} />
              <strong>{stats.data!.counts[k]}</strong>
              <span>{KIND_LABELS[k].plural}</span>
            </div>
          ))}
          <div className="stat">
            <Icon name="trash" />
            <strong>{stats.data.deleted}</strong>
            <span>בסל המחזור</span>
          </div>
          <div className="stat">
            <Icon name="archive" />
            <strong>{formatBytes(stats.data.bytes)}</strong>
            <span>נפח קבצים</span>
          </div>
        </div>
      )}

      <div className="chips" role="tablist">
        <button role="tab" aria-selected={view === 'trash'} className={`chip ${view === 'trash' ? 'is-active' : ''}`} onClick={() => setView('trash')}>
          <Icon name="trash" size={16} />
          סל מחזור
        </button>
        {ITEM_KINDS.map((k) => (
          <button key={k} role="tab" aria-selected={view === k} className={`chip ${view === k ? 'is-active' : ''}`} onClick={() => setView(k)}>
            {KIND_LABELS[k].plural}
          </button>
        ))}
      </div>

      {view === 'trash' && <p className="muted">פריטים שנמחקו נשמרים כאן עם כל הקבצים, ואפשר לשחזר אותם בכל עת.</p>}

      {list.loading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox message={list.error} onRetry={list.reload} />
      ) : !list.data?.items.length ? (
        <p className="muted-center">{view === 'trash' ? 'סל המחזור ריק.' : 'אין פריטים בקטגוריה זו.'}</p>
      ) : (
        <ul className="list">
          {list.data.items.map((it) => (
            <li key={it.id}>
              <ItemRowCard item={it} to={`/item/${it.id}`}>
                {view === 'trash' ? (
                  <>
                    <span className="muted small">נמחק {it.deletedAt ? formatDate(it.deletedAt) : ''}</span>
                    <button className="btn btn--primary btn--sm" onClick={() => act(() => api.restore(it.id), 'הפריט שוחזר')}>
                      <Icon name="restore" size={18} />
                      שחזור
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn--danger-ghost btn--sm"
                    onClick={() => window.confirm(`למחוק את ״${it.title}״? אפשר יהיה לשחזר מסל המחזור.`) && act(() => api.remove(it.id), 'הפריט הועבר לסל המחזור')}
                  >
                    <Icon name="trash" size={18} />
                    מחיקה
                  </button>
                )}
              </ItemRowCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TagsSection() {
  const toast = useToast();
  const tags = useLoad(() => api.tags(), []);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const rename = async () => {
    if (!editing) return;
    try {
      await api.admin.renameTag(editing.id, editing.name);
      toast('התגית עודכנה');
      setEditing(null);
      tags.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const remove = async (id: number, name: string) => {
    if (!window.confirm(`להסיר את התגית #${name} מכל הפריטים? הפריטים עצמם לא יימחקו.`)) return;
    try {
      await api.admin.deleteTag(id);
      toast('התגית הוסרה');
      tags.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (tags.loading) return <Spinner />;
  if (tags.error) return <ErrorBox message={tags.error} onRetry={tags.reload} />;
  return (
    <div className="stack">
      <p className="muted">תגיות נוצרות אוטומטית כשבני המשפחה מוסיפים אותן לפריטים. כאן אפשר לתקן שם (שינוי לשם קיים יאחד את התגיות) או להסיר.</p>
      {!tags.data?.length ? (
        <p className="muted-center">עדיין אין תגיות.</p>
      ) : (
        <ul className="rows panel">
          {tags.data.map((t) => (
            <li key={t.id} className="rows__row">
              {editing?.id === t.id ? (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); rename(); }}>
                  <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="שם התגית" />
                  <button className="btn btn--primary btn--sm">שמירה</button>
                  <button type="button" className="btn btn--text btn--sm" onClick={() => setEditing(null)}>ביטול</button>
                </form>
              ) : (
                <>
                  <span>
                    <strong>#{t.name}</strong> <span className="muted">({t.count})</span>
                  </span>
                  <span>
                    <button className="btn btn--text btn--sm" onClick={() => setEditing({ id: t.id, name: t.name })}>שינוי שם</button>
                    <button className="btn btn--text btn--sm" onClick={() => remove(t.id, t.name)}>הסרה</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  setup: 'הקמת המערכת',
  'item.create': 'הוספת פריט',
  'item.edit': 'עריכת פריט',
  'item.delete': 'מחיקת פריט',
  'item.restore': 'שחזור פריט',
  'comment.delete': 'מחיקת תגובה',
  'invite.create': 'יצירת הזמנה',
  'invite.accept': 'הצטרפות בהזמנה',
  'invite.revoke': 'ביטול הזמנה',
  'user.update': 'עדכון משתמש',
  'user.reset_link': 'קישור איפוס סיסמה',
  'user.password_reset': 'איפוס סיסמה',
  'settings.update': 'עדכון הגדרות',
  'hero.update': 'החלפת תמונה ראשית',
  'tag.rename': 'שינוי שם תגית',
  'tag.delete': 'הסרת תגית',
  'archive.export': 'ייצוא הארכיון',
  'backup.run': 'הרצת גיבוי',
};

export function ActivitySection() {
  const log = useLoad(() => api.admin.audit(), []);
  if (log.loading) return <Spinner />;
  if (log.error) return <ErrorBox message={log.error} onRetry={log.reload} />;
  return (
    <ul className="rows panel">
      {log.data!.map((a) => (
        <li key={a.id} className="rows__row">
          <span>
            <strong>{ACTION_LABEL[a.action] ?? a.action}</strong>
            {a.target_type && KIND_LABELS[a.target_type as ItemKind] && <span className="muted"> · {KIND_LABELS[a.target_type as ItemKind].singular}</span>}
          </span>
          <span className="muted small">
            {a.user_name ?? '—'} · {new Date(a.created_at).toLocaleString('he-IL')}
          </span>
        </li>
      ))}
    </ul>
  );
}
