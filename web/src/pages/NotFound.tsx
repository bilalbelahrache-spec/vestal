import { Link } from "../router";

export function NotFound() {
  return (
    <div class="not-found">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go home</Link>
      </p>
    </div>
  );
}
