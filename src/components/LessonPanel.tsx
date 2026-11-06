import { useLesson } from '../state/project';

export function LessonPanel() {
  const lesson = useLesson((s) => s.lesson);
  const setLesson = useLesson((s) => s.setLesson);
  if (!lesson) return null;
  return (
    <section className="lesson">
      <h3>
        {lesson.title}
        <button className="close" onClick={() => setLesson(null)} aria-label="Close lesson">
          ×
        </button>
      </h3>
      <p className="hint">{lesson.summary}</p>
      <ol>
        {lesson.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </section>
  );
}
