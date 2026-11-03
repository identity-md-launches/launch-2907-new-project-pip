import type { FoodId } from '../game/engine';

export function FoodIcon({ food }: { food: FoodId }) {
  if (food === 'seed')
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5c4 3.5 5 9 3.6 13.4C14.8 18.6 13.5 21 12 21.5c-1.5-.5-2.8-2.9-3.6-5.6C7 11.5 8 6 12 2.5z" fill="#6b5039" />
        <path d="M12 5v14" stroke="#e9dcc8" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  if (food === 'carrot')
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19.5L15.5 8.5c1.6-1.6 3.6-.2 2.3 1.9L7 21z" fill="#f08a24" />
        <path d="M16 7.5c-.5-2 .2-3.6 1.7-4.5M17 8c1.6-1.3 3.4-1.4 4.6-.5M16.6 7.8c.3-1.8 1.6-3 3.3-3.3" stroke="#3f8f3b" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="14" r="5" fill="#d23a54" />
      <circle cx="15.5" cy="14.5" r="4.5" fill="#b8243f" />
      <path d="M11 9c.5-2.5 2-4 4.5-4.5" stroke="#3f8f3b" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export const SHAPES = ['seed', 'carrot', 'berry', 'ball'] as const;
export function ShapeIcon({ shape }: { shape: (typeof SHAPES)[number] }) {
  if (shape === 'ball')
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="#5aa9e6" />
        <path d="M5 10c4 2 10 2 14 0" stroke="#fff" strokeWidth="1.6" fill="none" />
      </svg>
    );
  return <FoodIcon food={shape} />;
}

export function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {on ? (
        <path d="M15.5 9a4.5 4.5 0 010 6M18 6.5a8 8 0 010 11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}
