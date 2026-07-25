export function createStatus(
  message: string,
  className = "status",
): HTMLElement {
  const status = document.createElement("p");
  status.className = className;
  status.textContent = message;
  return status;
}

export function createButton(
  label: string,
  action: string,
  className: string,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

export function appendIdentity(
  list: HTMLDListElement,
  label: string,
  value: string,
): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}
