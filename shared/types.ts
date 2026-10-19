// טיפוסים משותפים לצד הלקוח ולצד השרת.

export type ItemKind = 'photo' | 'video' | 'audio' | 'story' | 'document';
export type Role = 'admin' | 'member';
export type StoryType = 'family' | 'personal' | 'joke' | 'saying' | 'funny' | 'lesson';
export type FileRole = 'original' | 'thumb' | 'poster';
export type CommentKind = 'comment' | 'memory';

export interface PublicUser {
  id: string;
  name: string;
}

export interface CurrentUser extends PublicUser {
  email: string;
  role: Role;
}

export interface FileInfo {
  id: string;
  role: FileRole;
  mime: string;
  size: number;
  originalName: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

/** סרטון שמוצג מ-Google Drive במקום קובץ שנשמר באתר */
export interface ExternalVideo {
  provider: 'gdrive';
  fileId: string;
  url: string;
}

export interface ItemSummary {
  id: string;
  kind: ItemKind;
  title: string;
  description: string | null;
  excerpt: string | null;
  storyType: StoryType | null;
  dateText: string | null;
  dateYear: number | null;
  people: string | null;
  tags: string[];
  createdAt: number;
  createdBy: PublicUser;
  files: FileInfo[];
  externalVideo: ExternalVideo | null;
  /** לסיפור: תמונה ממוזערת של תמונת הסיפור הראשונה (אם יש) */
  coverFileId: string | null;
  commentCount: number;
  deletedAt: number | null;
}

/** תמונה של סיפור — נשמרת עם הסיפור (R2), לא חלק מגלריית התמונות */
export interface StoryImage {
  id: string;
  fileId: string;
  thumbId: string | null;
  width: number | null;
  height: number | null;
  mime: string;
}

export interface CommentInfo {
  id: string;
  kind: CommentKind;
  body: string;
  createdAt: number;
  createdBy: PublicUser;
}

export type TranscriptStatus = 'none' | 'pending' | 'processing' | 'done' | 'failed';

export interface ItemDetail extends ItemSummary {
  body: string | null;
  updatedAt: number;
  links: ItemSummary[];
  /** לסיפור: התמונות שלו, לפי הסדר (הראשונה — תמונת הסיפור) */
  storyImages: StoryImage[];
  comments: CommentInfo[];
  transcriptStatus: TranscriptStatus;
}

export interface HeroTraits {
  quotes: string[];
  symbols: { icon: string; label: string }[];
  details: { label: string; value: string }[];
}

/** תמונה מאוסף ״תמונות לדף הבית״: נקודת מיקוד (באחוזים) והגדלה, כדי שהפנים יישבו היטב בעיגול */
export interface HomePhotoSetting {
  itemId: string;
  x: number;
  y: number;
  zoom: number;
}

export interface HomePhoto extends HomePhotoSetting {
  /** קובץ להצגה — ממוזערת אם קיימת, אחרת המקור */
  fileId: string;
}

export interface SiteSettings {
  siteTitle: string;
  subtitle: string;
  heroFileId: string | null;
  heroTraits: HeroTraits;
  homePhotos: HomePhoto[];
  /** קישור תיקיית Google Drive המשפחתית (רק כשהחיבור פעיל) — לכפתור ״הוספת תמונות לדרייב״ */
  driveFolderUrl: string | null;
}

/** מצב החיבור לתיקיית Google Drive — למנהל בלבד */
export interface DriveStatus {
  state: 'disconnected' | 'ok' | 'error';
  apiKeyConfigured: boolean;
  folder: { url: string; name: string; connectedAt: number } | null;
  lastSyncAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  photoCount: number;
  added: number;
  removed: number;
  pending: number;
}

export interface AuthStatus {
  setupRequired: boolean;
  user: CurrentUser | null;
  siteTitle: string;
}

export interface TagInfo {
  id: number;
  name: string;
  count: number;
}

export interface SearchResults {
  query: string;
  total: number;
  groups: { kind: ItemKind; items: ItemSummary[] }[];
}

export interface AdminUser extends CurrentUser {
  createdAt: number;
  lastLoginAt: number | null;
  disabledAt: number | null;
}

export interface InviteInfo {
  id: string;
  email: string | null;
  note: string | null;
  role: Role;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  revokedAt: number | null;
  createdBy: string;
}

export interface BackupStatus {
  backupBucketConfigured: boolean;
  lastRun: BackupRun | null;
  recentRuns: BackupRun[];
  filesTotal: number;
  filesBackedUp: number;
  bytesTotal: number;
}

export interface BackupRun {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'ok' | 'partial' | 'failed' | 'skipped';
  filesCopied: number;
  bytesCopied: number;
  snapshotKey: string | null;
  message: string | null;
}

export interface ArchiveStats {
  counts: Record<ItemKind, number>;
  deleted: number;
  users: number;
  bytes: number;
}
