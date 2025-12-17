/**
 * 介護保険第2号被保険者判定のユーティリティ関数
 * 
 * 徴収開始：「満40歳に達したとき」＝ 40歳の誕生日の前日。その前日が属する月から第2号になり、介護保険料の徴収が始まる
 * 徴収終了：「満65歳に達したとき」＝ 65歳の誕生日の前日。その前日が属する月から第2号ではなくなり、徴収されなくなる
 */

/**
 * 指定された日付が介護保険第2号被保険者に該当するかどうかを判定する
 * @param birthDate 生年月日（Dateオブジェクト、またはYYYY-MM-DD形式の文字列、またはタイムスタンプ）
 * @param targetDate 判定対象日（省略時は現在日時）。YYYY-MM形式の文字列、またはDateオブジェクト
 * @returns 第2号被保険者に該当する場合true、該当しない場合false
 */
export function isCareSecondInsured(
  birthDate: Date | string | number | undefined | null,
  targetDate?: Date | string,
): boolean {
  if (!birthDate) {
    return false;
  }

  // 生年月日をDateオブジェクトに変換
  const birth = typeof birthDate === 'string' 
    ? new Date(birthDate) 
    : typeof birthDate === 'number' 
    ? new Date(birthDate) 
    : birthDate;

  if (isNaN(birth.getTime())) {
    return false;
  }

  // 判定対象日を取得（YYYY-MM形式の文字列の場合はその月の1日、Dateオブジェクトの場合はその日付）
  let target: Date;
  if (!targetDate) {
    target = new Date();
  } else if (typeof targetDate === 'string') {
    // YYYY-MM形式の文字列の場合
    const [year, month] = targetDate.split('-').map(Number);
    if (isNaN(year) || isNaN(month)) {
      target = new Date();
    } else {
      target = new Date(year, month - 1, 1);
    }
  } else {
    target = targetDate;
  }

  // 40歳の誕生日の前日を計算
  const age40Birthday = new Date(birth.getFullYear() + 40, birth.getMonth(), birth.getDate());
  const age40StartDate = new Date(age40Birthday);
  age40StartDate.setDate(age40StartDate.getDate() - 1);
  // その前日が属する月（40歳の誕生日の前日が属する月）
  const age40StartMonth = new Date(age40StartDate.getFullYear(), age40StartDate.getMonth(), 1);

  // 65歳の誕生日の前日を計算
  const age65Birthday = new Date(birth.getFullYear() + 65, birth.getMonth(), birth.getDate());
  const age65StartDate = new Date(age65Birthday);
  age65StartDate.setDate(age65StartDate.getDate() - 1);
  // その前日が属する月（65歳の誕生日の前日が属する月）
  const age65StartMonth = new Date(age65StartDate.getFullYear(), age65StartDate.getMonth(), 1);

  // 判定対象日の月を取得（月の1日に正規化）
  const targetMonth = new Date(target.getFullYear(), target.getMonth(), 1);

  // 40歳の誕生日の前日が属する月以上、かつ65歳の誕生日の前日が属する月未満の場合に第2号被保険者
  return targetMonth >= age40StartMonth && targetMonth < age65StartMonth;
}

/**
 * 生年月日から現在時点での介護保険第2号被保険者フラグを自動判定する
 * @param birthDate 生年月日（Dateオブジェクト、またはYYYY-MM-DD形式の文字列、またはタイムスタンプ）
 * @returns 第2号被保険者に該当する場合true、該当しない場合false
 */
export function calculateCareSecondInsured(
  birthDate: Date | string | number | undefined | null,
): boolean {
  return isCareSecondInsured(birthDate);
}

