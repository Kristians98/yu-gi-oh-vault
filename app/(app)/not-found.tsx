import Link from "next/link";
export default function NotFound() {
  return (
    <div className="content">
      <div className="errorbox">
        <h1>Not found</h1>
        <p>That page or card doesn&rsquo;t exist — or you don&rsquo;t have access to it.</p>
        <Link className="btn-add" href="/">Back to your binder</Link>
      </div>
    </div>
  );
}
