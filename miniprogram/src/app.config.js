export default {
  pages: ['pages/index/index'],
  window: {
    navigationBarTitleText: '半醒半松',
    navigationBarBackgroundColor: '#f4f0ea',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f4f0ea'
  },
  // 位置权限的用途说明，审核会看这一句
  permission: {
    'scope.userLocation': {
      desc: '用于按当前位置查找附近的咖啡店与按摩店'
    }
  },
  // 2022 年起 getLocation 必须在此声明，否则调用直接失败
  requiredPrivateInfos: ['getLocation']
}
