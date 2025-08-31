import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-footer-bar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
})
export class FooterBarComponent {
  readonly year = new Date().getFullYear();

  termsOpen = signal(false);

  openTerms() {
    this.termsOpen.set(true);
  }
  closeTerms() {
    this.termsOpen.set(false);
  }
  onBackdrop(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('modal-backdrop')) this.closeTerms();
  }
  onEsc(e: KeyboardEvent) {
    if (e.key === 'Escape') this.closeTerms();
  }
}
