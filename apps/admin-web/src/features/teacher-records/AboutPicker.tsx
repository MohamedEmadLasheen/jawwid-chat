import { useId } from 'react'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { R, useCopy } from './copy'
import { useTeacherStudents } from './hooks'

/**
 * PD-52: who a record about this teacher is about -- one of their students
 * (learner_id; the family follows) or, for a trial, its trial family. The
 * choices are the server's (GET /teacher-records/teachers/:id/students), so
 * they are only those the caller may record about. `value` is
 * `learner:<id>` | `prospect:<id>` | '' (see aboutFields).
 */
export function AboutPicker({
  teacherId,
  value,
  onChange,
  required,
  error,
}: {
  teacherId: string
  value: string
  onChange: (value: string) => void
  required: boolean
  error?: boolean
}) {
  const tx = useCopy()
  const id = useId()
  const options = useTeacherStudents(teacherId)
  const students = options.data?.students ?? []
  const trials = options.data?.trials ?? []
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {required ? tx(R.about) : tx(R.student)}
      </label>
      <SearchableSelect id={id} className="input" value={value} disabled={!teacherId} onValueChange={(v) => onChange(v)}>
        <option value="">—</option>
        {students.map((s) => (
          <option key={`l-${s.id}`} value={`learner:${s.id}`}>
            {s.name}
          </option>
        ))}
        {trials.map((t) => (
          <option key={`p-${t.id}`} value={`prospect:${t.id}`}>
            {tx(R.trialOf, { name: t.name })}
          </option>
        ))}
      </SearchableSelect>
      {error && <p className="field__error">{tx(R.required)}</p>}
    </div>
  )
}
