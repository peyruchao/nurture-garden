export class Router {
  constructor(private readonly render: () => void) {
    addEventListener("popstate", this.render);
  }

  navigate(path: string): void {
    history.pushState({}, "", path);
    this.render();
  }
}
