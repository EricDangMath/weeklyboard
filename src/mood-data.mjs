export const MOODS = [
  { id: 'happy', label: '开心', color: '#DBB355' },
  { id: 'great', label: '超棒', color: '#C85E3D' },
  { id: 'excited', label: '兴奋', color: '#D96A8B' },
  { id: 'calm', label: '平静', color: '#5A8A8E' },
  { id: 'tired', label: '疲惫', color: '#3D7695' },
  { id: 'sad', label: '难过', color: '#7B6FA0' },
  { id: 'angry', label: '生气', color: '#B23B2E' },
  { id: 'sick', label: '不适', color: '#7E9B57' },
  { id: 'phone', label: '玩手机', color: '#D98E43' },
  { id: 'busy', label: '忙碌', color: '#8B7E6A' },
  { id: 'sleepy', label: '困', color: '#8394BE' },
  { id: 'philo', label: '哲学状态', color: '#55688F' },
];
export const MOOD_BY_ID = Object.fromEntries(MOODS.map((mood) => [mood.id, mood]));
export const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function validMoodDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function moodDays(today, count = 28) {
  const date = new Date(`${today}T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(date);
    day.setDate(day.getDate() - count + index + 1);
    return localDateKey(day);
  });
}
export function moodTrend(records, today) {
  const byDate = new Map(records.map((record) => [record.date, record.mood]));
  const days = moodDays(today).map((date) => ({ date, mood: MOOD_BY_ID[byDate.get(date)] || null }));
  const counts = new Map();
  for (const { mood } of days) if (mood) counts.set(mood.id, (counts.get(mood.id) || 0) + 1);
  return {
    days,
    recorded: days.filter((day) => day.mood).length,
    top: MOODS.filter((mood) => counts.has(mood.id)).map((mood) => ({ ...mood, count: counts.get(mood.id) }))
      .sort((a, b) => b.count - a.count).slice(0, 3),
  };
}
