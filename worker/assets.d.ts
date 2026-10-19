// ייבוא קובץ כ-data URI (Vite ‎?inline) — לנכסים קטנים שמוגשים מה-Worker למשתמשים מחוברים בלבד
declare module '*?inline' {
  const src: string;
  export default src;
}
