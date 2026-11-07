import React from 'react';

const messages={
 en:['Contract data could not load. You can continue exploring this page.','Reload this page'],
 ar:['تعذر تحميل بيانات العقد. يمكنك متابعة تصفح هذه الصفحة.','إعادة تحميل الصفحة'],
 tr:['Sözleşme verileri yüklenemedi. Bu sayfayı incelemeye devam edebilirsiniz.','Sayfayı yeniden yükle'],
 'zh-CN':['合约数据加载失败。您可以继续浏览此页面。','重新加载此页面'],
 ru:['Не удалось загрузить данные контракта. Вы можете продолжить просмотр страницы.','Перезагрузить страницу'],
 es:['No se pudieron cargar los datos del contrato. Puedes seguir explorando esta página.','Volver a cargar esta página'],
 fa:['اطلاعات قرارداد بارگذاری نشد. می‌توانید بخش‌های دیگر این صفحه را بررسی کنید.','بارگذاری دوبارهٔ صفحه'],
};

// A failed optional chunk must not unmount the rest of the public landing.
// Recovery is explicit and keeps the current URL, language and referral.
export class LiveDataBoundary extends React.Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(!this.state.failed)return this.props.children;
  const [message,reload]=messages[this.props.lang]||messages.en;
  return <div className="container loading-data"><p role="status">{message}</p><button type="button" className="button outline" onClick={()=>window.location.reload()}>{reload}</button></div>;
 }
}
