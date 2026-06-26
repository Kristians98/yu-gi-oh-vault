"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="content">
      <div className="errorbox">
        <h1>Something went wrong</h1>
        <p>{error.message || "An unexpected error occurred. Try again in a moment."}</p>
        <button className="btn-add" onClick={reset}>Try again</button>
      </div>
    </div>
  );
}
