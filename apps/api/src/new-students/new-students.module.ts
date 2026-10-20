import { Module } from '@nestjs/common';
import { NewStudentsService } from './new-students.service';

/**
 * Trial journey: Sales' subscription form and the New Students page's data.
 * The ONLY module that may read chat.trial_subscription, which holds a parent's
 * phone and e-mail (G-07; new-students-confinement.spec.ts). TrialService calls
 * it inside its own transactions; nothing here posts a card or an event.
 */
@Module({
  providers: [NewStudentsService],
  exports: [NewStudentsService],
})
export class NewStudentsModule {}
