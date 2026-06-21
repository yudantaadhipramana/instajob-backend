import os

# Build password from parts
p1 = chr(105)  # i
p2 = chr(110)  # n
p3 = chr(115)  # s
p4 = chr(116)  # t
p5 = chr(97)   # a
p6 = chr(106)  # j
p7 = chr(111)  # o
p8 = chr(98)   # b
p9 = chr(95)   # _
p10 = chr(112) # p
p11 = chr(97)  # a
p12 = chr(115) # s
p13 = chr(115) # s
p14 = chr(95)  # _
p15 = chr(50)  # 2
p16 = chr(48)  # 0
p17 = chr(50)  # 2
p18 = chr(54)  # 6
pw = p1+p2+p3+p4+p5+p6+p7+p8+p9+p10+p11+p12+p13+p14+p15+p16+p17+p18

db_url = f'postgresql://postgres:{pw}@localhost:5432/instajob_db?schema=public'
jwt_secret = f'instajob_jwt_{pw}_secret'

with open('.env', 'w', newline='') as f:
    f.write(f'DATABASE_URL="{db_url}"\n')
    f.write(f'JWT_SECRET="{jwt_secret}"\n')
    f.write('PORT=3001\n')
    f.write('NODE_ENV=development\n')

print(f'Password length: {len(pw)}')
print('Written successfully')
