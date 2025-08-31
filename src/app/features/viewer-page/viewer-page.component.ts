import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ThreeCanvasComponent } from '../../ui-three/three-canvas.component';
import { CommonModule } from '@angular/common';
import { HeartStore } from '../../state/heart.store';

@Component({
  selector: 'viewer-page',
  standalone: true,
  imports: [CommonModule, ThreeCanvasComponent],
  templateUrl: './viewer-page.component.html',
  styleUrls: ['./viewer-page.component.scss'],
})
export class ViewerPageComponent {
  constructor(private router: Router) {}

  // expose selectedId from the store for template checks
  protected store = inject(HeartStore);
  protected selectedId = this.store.selectedId;

  logout() {
    try {
      localStorage.removeItem('auth');
    } catch {}
    this.router.navigateByUrl('/');
  }
}
