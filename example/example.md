## 我是一个标题

~~这是一个删除线~~

*这是斜体*

**这是粗体**

> 这是引用
> > 这是多级引用

\* <- 这是被转义的星号

```cpp line-numbers lines=6-7
#include<bits/stdc++.h>
using namespace std;
typedef long long LL;
//十年OI一场空，不开long long见祖宗
int main(){
    //freopen(".in" , "r" , stdin);
    //freopen(".out" , "w" , stdout);
    int a , b;
    scanf("%d%d" , &a , &b);
    printf("%d" , a + b);
    return 0;
}
```

这是洛谷特色的代码框。

- 这是无序列表
- 这是无序列表
  - 这是嵌套的无序列表
  - 这是嵌套的无序列表

1. 这是有序列表
2. 这是有序列表
3. 这是有序列表

- [x] 这是任务列表
- [ ] 这是任务列表
- [ ] 这是任务列表

这是一个[链接](https://www.luogu.com.cn)。

这是一个图片：

![](https://cdn.luogu.com.cn/upload/usericon/1523280.png)

这是一些表格：

| 我是左对齐 | 我是居中对齐 | 我是右侧对齐 |
|:---|:---:|---:|
| 内容 | 内容 | 内容 |

| 标题 1| 标题 2| 标题 3    |标题 4|
|:-:|:--------:|:--------:|:--:|
|1  |$\le 10$  |$\le 10$  |无   |
|2  |^         |^         |无   |
|3  |^         |^         |无   |
|4  |$\le 3\times 10^5$|^         |无   |
|5  |^         |^         |无   |
|6  |^         |$\le 3\times 10^5$|无   |
|7  |^         |^         |无   |
|8  |^         |^         |无   |
|9  |^         | 跨列合并 1         |<   |
|10 |跨列合并 2         |<         |无   |

::cute-table{tuack}

| 测试点编号 | $n, m \leq$ | $k \leq$ | 特殊性质 |
| :-: | :-: | :-: | :-: |
| $1, 2$ | $6$ | $6$ | C |
| $3 \sim 5$ | $10^3$ | $10^3$ | ^ |
| $6 \sim 8$ | $5 \times 10^4$ | $10^2$ | 无 |
| $9, 10$ | $10^5$ | $10^5$ | AB |
| $11, 12$ | ^ | ^ | A |
| $13 \sim 15$ | ^ | ^ | C |
| $16 \sim 18$ | ^ | ^ | 无 |
| $19, 20$ | $3 \times 10^5$ | $2.5 \times 10^5$ | ^ |

:::align{center}

![](https://cdn.luogu.com.cn/upload/usericon/1523280.png)

这是居中排版
:::

:::align{right}

![](https://cdn.luogu.com.cn/upload/usericon/1523280.png)

这是居右排版
:::

:::epigraph[——a_small_OIer]
这是一个引言。
:::

这是一些折叠框：

::::info[我是标题]
大家好啊，我是说的道理，今天来点大家想看的东西。
::::

::::info[我是默认展开的折叠框]{open}
使用 `{open}` 使折叠框默认展开。
::::

::::success[$$\displaystyle\sum_{i = 1}^n \sum_{j = 1}^n \gcd(i, j)$$]
数学公式也是可以出现在标题上的。
::::

::::warning[警告]
这是一个警告框。
::::

::::error[错误]
这是一个错误框。
::::

::::::warning[我是警告]

:::::warning[不要]

::::warning[滥用]

:::warning[嵌套]
这是嵌套折叠框。
:::
::::
:::::
::::::