import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  NonNullableFormBuilder,
  Validators,
  FormGroup,
  FormControl,
} from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  readonly correctUser = 'technical003';
  readonly correctPass = '2#_fd*iq3i032';

  showPassword = signal(false);
  loading = signal(false);
  authError = signal('');

  form!: FormGroup<{ username: FormControl<string>; password: FormControl<string> }>;

  constructor(private fb: NonNullableFormBuilder, private router: Router) {
    this.form = this.fb.group({
      username: ['', [Validators.required]],
      password: ['', [Validators.required]],
    });
  }

  toggleShowPassword() {
    this.showPassword.update((v) => !v);
  }

  submit() {
    this.authError.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Shake the card on validation errors
      const card = document.querySelector('.login-card');
      card?.classList.remove('shake');
      (card as HTMLElement)?.offsetWidth; // reflow to restart animation
      card?.classList.add('shake');
      return;
    }
    const { username, password } = this.form.getRawValue();
    if (username !== this.correctUser || password !== this.correctPass) {
      this.authError.set('Invalid username or password');
      // Shake the card on auth error
      const card = document.querySelector('.login-card');
      card?.classList.remove('shake');
      // Reflow to restart animation
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      (card as HTMLElement)?.offsetWidth;
      card?.classList.add('shake');
      return;
    }
    this.loading.set(true);
    this.form.disable({ emitEvent: false });
    setTimeout(() => {
      try {
        localStorage.setItem('auth', '1');
      } catch {}
      this.router.navigateByUrl('/viewer');
    }, 2500);
  }
}
