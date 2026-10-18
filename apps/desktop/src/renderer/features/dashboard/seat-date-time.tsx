import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import dateZhCN from 'antd/es/date-picker/locale/zh_CN';

dayjs.locale('zh-cn');

/** Local wall time for a seat form. The command still stores a UTC instant. */
export function SeatDateTime({
  label,
  placeholder,
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return <DatePicker
    aria-label={label}
    allowClear
    disabled={disabled}
    format="YYYY-MM-DD HH:mm"
    getPopupContainer={() => document.body}
    inputReadOnly={false}
    locale={dateZhCN}
    needConfirm={false}
    placeholder={placeholder}
    showTime={{ format: 'HH:mm' }}
    style={{ width: '100%' }}
    value={value ? dayjs(value) : null}
    onChange={(next) => onChange(next ? next.format('YYYY-MM-DDTHH:mm') : '')}
  />;
}
