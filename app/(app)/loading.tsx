export default function Loading() {
  return (
    <div className="content">
      <div className="loadergrid">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="skel-card" />
        ))}
      </div>
    </div>
  );
}
