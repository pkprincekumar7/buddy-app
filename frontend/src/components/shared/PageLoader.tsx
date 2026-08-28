import Spinner from './Spinner';

/** Full-viewport centered spinner — the standard "page is loading" state. */
export default function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner />
    </div>
  );
}
