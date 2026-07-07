/**
 * Buffering spinner — centered on the player while media loads.
 * Uses the project's global `.spinner` class for consistent styling.
 */
export function Spinner() {
  return (
    <div className="fx-spinner-wrap">
      <div className="spinner" />
    </div>
  );
}
